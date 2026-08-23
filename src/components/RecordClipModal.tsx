import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme/colors';

// Record-and-review: the low-risk version of "video" in DrillStreak. A
// player/parent records a set uninterrupted, watches it back, then logs
// makes/attempts using the existing result modal — same trust model as
// every other logged number in this app, just informed by rewatching
// instead of memory. Deliberately does NOT upload or persist the video
// anywhere DrillStreak controls: it goes straight to the device's own
// Photos library (expo-media-library, write-only permission) and this
// component never keeps a copy or reference to it once saved. That's the
// whole reason this feature needs almost no new privacy-policy language —
// DrillStreak never has custody of the video at any point.

type Phase = 'camera' | 'reviewing';

type Props = {
  visible: boolean;
  drillName: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function RecordClipModal({ visible, drillName, onClose, onSaved }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [libraryPermission, requestLibraryPermission] = MediaLibrary.usePermissions({ writeOnly: true });
  const [phase, setPhase] = useState<Phase>('camera');
  const [recording, setRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = useVideoPlayer(recordedUri, (p) => {
    p.loop = false;
  });

  const permissionsGranted =
    cameraPermission?.granted && microphonePermission?.granted && libraryPermission?.granted;
  const permissionsChecked =
    cameraPermission != null && microphonePermission != null && libraryPermission != null;

  const reset = () => {
    setPhase('camera');
    setRecording(false);
    setRecordedUri(null);
    setSaving(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleRequestPermissions = async () => {
    setError(null);
    const [cam, mic, lib] = await Promise.all([
      requestCameraPermission(),
      requestMicrophonePermission(),
      requestLibraryPermission(),
    ]);
    if (!cam.granted || !mic.granted || !lib.granted) {
      setError('DrillStreak needs camera, microphone, and photo permission to record a clip.');
    }
  };

  const handleStartRecording = async () => {
    if (!cameraRef.current) return;
    setError(null);
    setRecording(true);
    try {
      const result = await cameraRef.current.recordAsync();
      if (result?.uri) {
        setRecordedUri(result.uri);
        setPhase('reviewing');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recording failed.');
    } finally {
      setRecording(false);
    }
  };

  const handleStopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  const handleRetake = () => {
    setPhase('camera');
    setRecordedUri(null);
  };

  const handleSave = async () => {
    if (!recordedUri) return;
    setSaving(true);
    setError(null);
    try {
      await MediaLibrary.saveToLibraryAsync(recordedUri);
      reset();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save to Photos.');
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} presentationStyle="fullScreen">
      <View style={styles.container}>
        {!permissionsChecked || !permissionsGranted ? (
          <View style={styles.permissionScreen}>
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionBody}>
              DrillStreak uses your camera to record a clip of "{drillName}" so you can watch it back and
              count makes/attempts accurately. The clip saves straight to your Photos — DrillStreak never
              keeps a copy of it.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={styles.primaryButton} onPress={handleRequestPermissions}>
              <Text style={styles.primaryButtonText}>Allow Camera & Photos Access</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handleClose}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ) : phase === 'camera' ? (
          <View style={styles.container}>
            <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="back" />
            <View style={styles.cameraOverlay}>
              <Text style={styles.drillLabel}>{drillName}</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.cameraControls}>
                <Pressable style={styles.secondaryButton} onPress={handleClose} disabled={recording}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.recordButton, recording && styles.recordButtonActive]}
                  onPress={recording ? handleStopRecording : handleStartRecording}
                >
                  <Text style={styles.recordButtonText}>{recording ? 'Stop' : 'Record'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.container}>
            <VideoView player={player} style={styles.camera} nativeControls />
            <View style={styles.cameraOverlay}>
              <Text style={styles.drillLabel}>Watch it back, then log your count</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.cameraControls}>
                <Pressable style={styles.secondaryButton} onPress={handleRetake} disabled={saving}>
                  <Text style={styles.secondaryButtonText}>Retake</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save & Log Count</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  camera: { flex: 1 },
  cameraOverlay: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 10,
  },
  drillLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  cameraControls: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  recordButton: {
    flex: 1,
    backgroundColor: '#C4362B',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#7A1F17' },
  recordButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  permissionScreen: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  permissionTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permissionBody: { color: '#D0D0D5', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { color: '#FF8A80', fontSize: 13, textAlign: 'center' },
});
