import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { Drill } from '../lib/players';
import {
  createWorkoutTemplate,
  deleteWorkoutTemplate,
  listWorkoutTemplates,
  updateWorkoutTemplate,
  WorkoutTemplate,
} from '../lib/workouts';

type Props = {
  playerId: string;
  availableDrills: Drill[]; // the player's full visible library — already loaded by the caller
  onClose: () => void;
  onTemplatesChanged: () => void; // caller reloads its own template list (used for the Home quick-start chips)
};

// Two views in one modal: a list of saved workouts (with Edit/Delete/New),
// and a builder form (name + drill checklist) for creating or editing one.
// "Starting" a saved workout isn't handled here — Home just filters its
// already-loaded drill list down to a template's drill ids, reusing every
// existing mark-done/record/schedule control rather than duplicating them.
export default function WorkoutBuilderModal({ playerId, availableDrills, onClose, onTemplatesChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [editing, setEditing] = useState<WorkoutTemplate | 'new' | null>(null);
  const [name, setName] = useState('');
  const [selectedDrillIds, setSelectedDrillIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listWorkoutTemplates(playerId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workouts.');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setName('');
    setSelectedDrillIds(new Set());
    setEditing('new');
  };

  const startEdit = (template: WorkoutTemplate) => {
    setName(template.name);
    setSelectedDrillIds(new Set(template.drills.map((d) => d.id)));
    setEditing(template);
  };

  const toggleDrill = (drillId: string) => {
    setSelectedDrillIds((current) => {
      const next = new Set(current);
      if (next.has(drillId)) next.delete(drillId);
      else next.add(drillId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || selectedDrillIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createWorkoutTemplate(playerId, name.trim(), Array.from(selectedDrillIds));
      } else if (editing) {
        await updateWorkoutTemplate(editing.id, name.trim(), Array.from(selectedDrillIds));
      }
      setEditing(null);
      await load();
      onTemplatesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save workout.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (template: WorkoutTemplate) => {
    Alert.alert(`Delete "${template.name}"?`, "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWorkoutTemplate(template.id);
            await load();
            onTemplatesChanged();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete workout.');
          }
        },
      },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{editing ? (editing === 'new' ? 'New workout' : 'Edit workout') : 'Your workouts'}</Text>
            <Pressable onPress={editing ? () => setEditing(null) : onClose} hitSlop={8}>
              <Text style={styles.closeLink}>{editing ? 'Back' : 'Close'}</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {editing ? (
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                placeholder="Workout name (e.g. Shooting focus)"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
              />
              <Text style={styles.sectionLabel}>Pick drills ({selectedDrillIds.size} selected)</Text>
              {availableDrills.map((drill) => {
                const selected = selectedDrillIds.has(drill.id);
                return (
                  <Pressable
                    key={drill.id}
                    style={[styles.drillRow, selected && styles.drillRowSelected]}
                    onPress={() => toggleDrill(drill.id)}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{drill.name}</Text>
                      {drill.category ? <Text style={styles.rowBio}>{drill.category}</Text> : null}
                    </View>
                    <Text style={selected ? styles.checkSelected : styles.checkUnselected}>
                      {selected ? '✓' : '+'}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.button, (!name.trim() || selectedDrillIds.size === 0 || saving) && styles.buttonDisabled]}
                onPress={handleSave}
                disabled={!name.trim() || selectedDrillIds.size === 0 || saving}
              >
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Save workout</Text>}
              </Pressable>
            </ScrollView>
          ) : loading ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {templates.length === 0 ? (
                <Text style={styles.placeholder}>
                  No saved workouts yet — build a set of drills once and reuse it anytime.
                </Text>
              ) : (
                templates.map((t) => (
                  <View key={t.id} style={styles.templateRow}>
                    <Pressable style={styles.rowText} onPress={() => startEdit(t)}>
                      <Text style={styles.rowName}>{t.name}</Text>
                      <Text style={styles.rowBio}>{t.drills.map((d) => d.name).join(', ')}</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDelete(t)} hitSlop={8}>
                      <Text style={styles.deleteLink}>Delete</Text>
                    </Pressable>
                  </View>
                ))
              )}
              <Pressable style={styles.button} onPress={startNew}>
                <Text style={styles.buttonText}>+ Build a new workout</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, maxHeight: '85%', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  closeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 20 },
  error: { color: '#C4362B', fontSize: 13 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  scrollContent: { gap: 8, paddingBottom: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  drillRowSelected: { borderColor: colors.accent, backgroundColor: '#FFF8EA' },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowBio: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  checkSelected: { color: colors.accentDark, fontSize: 16, fontWeight: '700' },
  checkUnselected: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  deleteLink: { color: '#C4362B', fontSize: 13, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
