import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme/colors';

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

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
  // 2026-09-09, Jay's ask: for a drill logged by time (conditioning drills
  // with drills.tracks_time set) rather than makes/attempts, show a live
  // stopwatch while recording so a solo player doesn't have to separately
  // time themselves and then also operate the camera. Only shown when true
  // — a shooting drill's "watch it back and count" flow is unaffected.
  tracksTime: boolean;
  onClose: () => void;
  // Passes back the recorded clip's elapsed seconds (only when tracksTime
  // — null otherwise) so the caller can pre-fill the result screen's time
  // field. Still fully editable there — there's real lag between finishing
  // a solo drill and reaching the phone to hit Stop, Jay's explicit call.
  onSaved: (durationSeconds: number | null) => void;
};

export default function RecordClipModal({ visible, drillName, tracksTime, onClose, onSaved }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [libraryPermission, requestLibraryPermission] = MediaLibrary.usePermissions({ writeOnly: true });
  const [phase, setPhase] = useState<Phase>('camera');
  const [recording, setRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [capturedDuration, setCapturedDuration] = useState<number | null>(null);

  // Ticks once per second only while actually recording — cleared the
  // instant recording stops (not when recordAsync's promise later
  // resolves), so the displayed/captured time reflects the real Stop tap.
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);

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
    setElapsedSeconds(0);
    setCapturedDuration(null);
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
    setElapsedSeconds(0);
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
    // Freezes the displayed/captured time at the actual Stop tap, not
    // whenever recordAsync's promise later resolves — setRecording(false)
    // here stops the interval immediately; the finally block in
    // handleStartRecording redundantly does the same once the promise
    // settles, which is harmless.
    setCapturedDuration(elapsedSeconds);
    setRecording(false);
    cameraRef.current?.stopRecording();
  };

  const handleRetake = () => {
    setPhase('camera');
    setRecordedUri(null);
    setElapsedSeconds(0);
    setCapturedDuration(null);
  };

  const handleSave = async () => {
    if (!recordedUri) return;
    // Snapshot before reset() clears it — reset() runs before onSaved() so
    // the modal's closed by the time the parent screen reacts.
    const savedDuration = tracksTime ? capturedDuration : null;
    setSaving(true);
    setError(null);
    try {
      await MediaLibrary.saveToLibraryAsync(recordedUri);
      reset();
      onSaved(savedDuration);
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
              DrillStreak uses your camera to record a clip of "{drillName}" so you can
              {tracksTime ? ' time it accurately' : ' watch it back and count makes/attempts accurately'}. The
              clip saves straight to your Photos — DrillStreak never keeps a copy of it.
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
            {tracksTime && recording ? (
              <View style={styles.timerBadge}>
                <Text style={styles.timerText}>● {formatElapsed(elapsedSeconds)}</Text>
              </View>
            ) : null}
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
              <Text style={styles.drillLabel}>
                {tracksTime
                  ? `Recorded time: ${formatElapsed(capturedDuration ?? 0)} — editable on the next screen`
                  : 'Watch it back, then log your count'}
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.cameraControls}>
                <Pressable style={styles.secondaryButton} onPress={handleRetake} disabled={saving}>
                  <Text style={styles.secondaryButtonText}>Retake</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={handleSave} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>{tracksTime ? 'Save & Log Time' : 'Save & Log Count'}</Text>
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
  timerBadge: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  timerText: { color: '#FF6B5E', fontSize: 20, fontWeight: '700' },
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
