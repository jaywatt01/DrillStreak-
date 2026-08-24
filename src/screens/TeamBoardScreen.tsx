import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';
import { supabase } from '../lib/supabase';
import {
  deleteTeamMessage,
  listMyTeams,
  listTeamContacts,
  MyTeam,
  sendTeamMessage,
  setTeamMessagePinned,
  subscribeToTeamMessages,
  TeamContact,
  TeamMessage,
  getTeamMessages,
} from '../lib/teamMessages';
import {
  addTeamEventToCalendar,
  createTeamEvent,
  deleteTeamEvent,
  getLocallyAddedEventIds,
  getUpcomingTeamEvents,
  syncDeletedTeamEventsFromCalendar,
  TeamEvent,
} from '../lib/teamEvents';

type BoardView = 'messages' | 'calendar';

// null = the team-wide feed; a userId = a private 1:1 thread with that contact.
type ThreadKey = string | null;

function dateToDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateToTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

function formatEventWhen(event: TeamEvent): string {
  const [year, month, day] = event.eventDate.split('-').map(Number);
  const dateLabel = new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (!event.eventTime) return dateLabel;
  const [hours, minutes] = event.eventTime.split(':').map(Number);
  const timeLabel = new Date(year, month - 1, day, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dateLabel} · ${timeLabel}`;
}

export default function TeamBoardScreen() {
  // Set when this screen was opened by tapping a push notification
  // (App.tsx's navigateFromNotification) — lands on the actual
  // team/conversation the notification was about, instead of whatever
  // team/thread happened to be selected before.
  const route = useRoute();
  const notificationParams = route.params as
    | { teamId?: string; threadUserId?: string; view?: BoardView }
    | undefined;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const activeTeam = teams.find((t) => t.id === activeTeamId) ?? null;

  const [view, setView] = useState<BoardView>('messages');

  const [contacts, setContacts] = useState<TeamContact[]>([]);
  const [thread, setThread] = useState<ThreadKey>(null);

  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [composerText, setComposerText] = useState('');
  const [replyingTo, setReplyingTo] = useState<TeamMessage | null>(null);
  const [sending, setSending] = useState(false);

  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [addedToCalendarIds, setAddedToCalendarIds] = useState<Set<string>>(new Set());
  const [addingEvent, setAddingEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState('');
  const [newEventDate, setNewEventDate] = useState(new Date());
  const [newEventTime, setNewEventTime] = useState(new Date());
  const [newEventLocation, setNewEventLocation] = useState('');
  const [newEventNotes, setNewEventNotes] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      setMyUserId(userData.user?.id ?? null);

      const myTeams = await listMyTeams();
      setTeams(myTeams);
      setActiveTeamId((current) => current ?? myTeams[0]?.id ?? null);

      // Not team-scoped — reconciles every event this device has ever
      // added, across every team, against what still exists server-side.
      await syncDeletedTeamEventsFromCalendar();
      setAddedToCalendarIds(await getLocallyAddedEventIds());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teams.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (notificationParams?.teamId) {
      setActiveTeamId(notificationParams.teamId);
      setThread(notificationParams.threadUserId ?? null);
      setView(notificationParams.view ?? 'messages');
    }
  }, [notificationParams?.teamId, notificationParams?.threadUserId, notificationParams?.view]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadTeamData = useCallback(async () => {
    if (!activeTeamId) return;
    try {
      const [msgs, teamContacts, upcoming] = await Promise.all([
        getTeamMessages(activeTeamId),
        listTeamContacts(activeTeamId),
        getUpcomingTeamEvents(activeTeamId),
      ]);
      setMessages(msgs);
      // A restricted account (self-signed-up player) only ever gets the
      // coach as a DM option — RLS would reject a DM to anyone else
      // anyway (team_messages_insert), so there's no point offering it.
      const isRestricted = teams.find((t) => t.id === activeTeamId)?.restricted ?? false;
      setContacts(
        isRestricted
          ? teamContacts.filter((c) => c.role === 'coach')
          : teamContacts.filter((c) => c.userId !== myUserId)
      );
      setEvents(upcoming);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team data.');
    }
  }, [activeTeamId, myUserId, teams]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  // Realtime: append anything new that lands in this team while the screen
  // is open. RLS already scopes what actually arrives here — see
  // subscribeToTeamMessages.
  useEffect(() => {
    if (!activeTeamId) return;
    const channel = subscribeToTeamMessages(activeTeamId, (message) => {
      setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTeamId]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    loadTeamData();
  };

  const isCoach = activeTeam?.role === 'coach';
  const isRestricted = activeTeam?.restricted ?? false;
  const coachContact = contacts.find((c) => c.role === 'coach');
  // A restricted account can compose only while viewing the coach thread
  // — the team-wide feed and any other DM stay read-only for them (RLS
  // would reject the insert anyway; this just avoids letting them type
  // into a composer that's about to fail).
  const canCompose = !isRestricted || (coachContact != null && thread === coachContact.userId);

  const threadMessages = useMemo(() => {
    return messages.filter((m) => {
      if (thread === null) return m.recipientUserId === null;
      return m.recipientUserId != null && (m.authorUserId === thread || m.recipientUserId === thread);
    });
  }, [messages, thread]);

  const pinnedMessages = useMemo(
    () => (thread === null ? threadMessages.filter((m) => m.pinned && m.parentMessageId === null) : []),
    [threadMessages, thread]
  );

  const topLevelMessages = threadMessages.filter((m) => m.parentMessageId === null);
  const repliesFor = (messageId: string) => threadMessages.filter((m) => m.parentMessageId === messageId);

  // `contacts` deliberately excludes the signed-in user (it's the DM
  // picker list) — check self first, then fall back to it. A message from
  // someone since removed from the roster (rare) falls back to a generic
  // label rather than showing nothing.
  const authorLabel = (userId: string): string => {
    if (userId === myUserId) return 'You';
    return contacts.find((c) => c.userId === userId)?.label ?? 'Team member';
  };

  const handleSend = async () => {
    if (!activeTeamId || !composerText.trim()) return;
    setSending(true);
    setError(null);
    try {
      const sent = await sendTeamMessage(activeTeamId, composerText.trim(), {
        recipientUserId: thread ?? undefined,
        parentMessageId: replyingTo?.id,
      });
      setMessages((current) => [...current, sent]);
      setComposerText('');
      setReplyingTo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleLongPressMessage = (message: TeamMessage) => {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (message.parentMessageId === null && message.recipientUserId === null && isCoach) {
      options.push({
        text: message.pinned ? 'Unpin' : 'Pin as announcement',
        onPress: async () => {
          try {
            await setTeamMessagePinned(message.id, !message.pinned);
            setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, pinned: !m.pinned } : m)));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update pin.');
          }
        },
      });
    }
    if (message.parentMessageId === null) {
      options.push({ text: 'Reply', onPress: () => setReplyingTo(message) });
    }
    if (message.authorUserId === myUserId || isCoach) {
      options.push({
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTeamMessage(message.id);
            setMessages((current) => current.filter((m) => m.id !== message.id));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete message.');
          }
        },
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(message.body.slice(0, 60), undefined, options);
  };

  const handleDatePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setNewEventDate(selected);
  };

  const handleTimePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setNewEventTime(selected);
  };

  const handleCreateEvent = async () => {
    if (!activeTeamId || !newEventTitle.trim()) return;
    setSavingEvent(true);
    setError(null);
    try {
      const created = await createTeamEvent(activeTeamId, {
        title: newEventTitle.trim(),
        eventType: newEventType.trim() || null,
        eventDate: dateToDateString(newEventDate),
        eventTime: dateToTimeString(newEventTime),
        location: newEventLocation.trim() || null,
        notes: newEventNotes.trim() || null,
      });
      setEvents((current) => [...current, created].sort((a, b) => a.eventDate.localeCompare(b.eventDate)));
      setAddingEvent(false);
      setNewEventTitle('');
      setNewEventType('');
      setNewEventLocation('');
      setNewEventNotes('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create event.');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = (event: TeamEvent) => {
    Alert.alert(`Remove ${event.title}?`, "Removes it from the team's shared calendar. Can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTeamEvent(event.id);
            setEvents((current) => current.filter((e) => e.id !== event.id));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete event.');
          }
        },
      },
    ]);
  };

  const handleAddToCalendar = async (event: TeamEvent) => {
    try {
      await addTeamEventToCalendar(event);
      setAddedToCalendarIds((current) => new Set(current).add(event.id));
      Alert.alert('Added', `${event.title} was added to your calendar.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add to calendar.');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (teams.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.placeholder}>
          Team Chat unlocks once you're on a team — as a coach with a team of your own, or as a
          parent/guardian of a player on someone else's roster.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {teams.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.teamPicker}>
          {teams.map((t) => (
            <Pressable
              key={t.id}
              style={[styles.chip, activeTeamId === t.id && styles.chipActive]}
              onPress={() => {
                setActiveTeamId(t.id);
                setThread(null);
              }}
            >
              <Text style={[styles.chipText, activeTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.viewToggle}>
        <Pressable
          style={[styles.toggleButton, view === 'messages' && styles.toggleButtonActive]}
          onPress={() => setView('messages')}
        >
          <Text style={[styles.toggleText, view === 'messages' && styles.toggleTextActive]}>Messages</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleButton, view === 'calendar' && styles.toggleButtonActive]}
          onPress={() => setView('calendar')}
        >
          <Text style={[styles.toggleText, view === 'calendar' && styles.toggleTextActive]}>Calendar</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {view === 'messages' ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={90}
        >
          {contacts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.threadPicker}>
              <Pressable style={[styles.chip, thread === null && styles.chipActive]} onPress={() => setThread(null)}>
                <Text style={[styles.chipText, thread === null && styles.chipTextActive]}>Team</Text>
              </Pressable>
              {contacts.map((c) => (
                <Pressable
                  key={c.userId}
                  style={[styles.chip, thread === c.userId && styles.chipActive]}
                  onPress={() => setThread(c.userId)}
                >
                  <Text style={[styles.chipText, thread === c.userId && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.messageList}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {pinnedMessages.map((m) => (
              <View key={m.id} style={styles.pinnedCard}>
                <Text style={styles.pinnedLabel}>📌 Announcement</Text>
                <Text style={styles.messageBody}>{m.body}</Text>
              </View>
            ))}

            {topLevelMessages.length === 0 ? (
              <Text style={styles.placeholder}>
                {thread === null ? 'No team messages yet — say hello.' : 'No messages in this conversation yet.'}
              </Text>
            ) : (
              topLevelMessages.map((m) => (
                <View key={m.id}>
                  <Pressable
                    style={[styles.messageBubble, m.authorUserId === myUserId && styles.messageBubbleMine]}
                    onLongPress={() => handleLongPressMessage(m)}
                  >
                    <Text style={styles.messageAuthor}>{authorLabel(m.authorUserId)}</Text>
                    <Text style={styles.messageBody}>{m.body}</Text>
                    <Text style={styles.messageMeta}>{new Date(m.createdAt).toLocaleString()}</Text>
                  </Pressable>
                  {repliesFor(m.id).map((r) => (
                    <Pressable
                      key={r.id}
                      style={[styles.replyBubble, r.authorUserId === myUserId && styles.messageBubbleMine]}
                      onLongPress={() => handleLongPressMessage(r)}
                    >
                      <Text style={styles.messageAuthor}>{authorLabel(r.authorUserId)}</Text>
                      <Text style={styles.messageBody}>{r.body}</Text>
                      <Text style={styles.messageMeta}>{new Date(r.createdAt).toLocaleString()}</Text>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </ScrollView>

          {replyingTo ? (
            <View style={styles.replyingBanner}>
              <Text style={styles.replyingText} numberOfLines={1}>
                Replying to: {replyingTo.body}
              </Text>
              <Pressable onPress={() => setReplyingTo(null)} hitSlop={8}>
                <Text style={styles.replyingCancel}>✕</Text>
              </Pressable>
            </View>
          ) : null}

          {canCompose ? (
            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                placeholder={thread === null ? 'Message the team…' : 'Message privately…'}
                placeholderTextColor={colors.textMuted}
                value={composerText}
                onChangeText={setComposerText}
                multiline
              />
              <Pressable
                style={[styles.sendButton, (!composerText.trim() || sending) && styles.buttonDisabled]}
                onPress={handleSend}
                disabled={!composerText.trim() || sending}
              >
                {sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sendButtonText}>Send</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.composerRow}>
              <Text style={styles.restrictedNotice}>
                You can view team announcements here. To send a message, switch to Coach above.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      ) : (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {isCoach ? (
            addingEvent ? (
              <View style={styles.editCard}>
                <TextInput
                  style={styles.input}
                  placeholder="Title (e.g. Home vs. Central)"
                  placeholderTextColor={colors.textMuted}
                  value={newEventTitle}
                  onChangeText={setNewEventTitle}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Type (game / practice / meal / other)"
                  placeholderTextColor={colors.textMuted}
                  value={newEventType}
                  onChangeText={setNewEventType}
                />
                <Text style={styles.modalLabel}>Date</Text>
                <DateTimePicker value={newEventDate} mode="date" onChange={handleDatePickerChange} />
                <Text style={styles.modalLabel}>Time</Text>
                <DateTimePicker value={newEventTime} mode="time" onChange={handleTimePickerChange} />
                <TextInput
                  style={styles.input}
                  placeholder="Location"
                  placeholderTextColor={colors.textMuted}
                  value={newEventLocation}
                  onChangeText={setNewEventLocation}
                />
                <TextInput
                  style={[styles.input, styles.noteInput]}
                  placeholder="Notes (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={newEventNotes}
                  onChangeText={setNewEventNotes}
                  multiline
                />
                <View style={styles.editButtonRow}>
                  <Pressable style={[styles.smallButton, styles.smallButtonSecondary]} onPress={() => setAddingEvent(false)}>
                    <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallButton, (!newEventTitle.trim() || savingEvent) && styles.buttonDisabled]}
                    onPress={handleCreateEvent}
                    disabled={!newEventTitle.trim() || savingEvent}
                  >
                    {savingEvent ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.smallButtonText}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.button} onPress={() => setAddingEvent(true)}>
                <Text style={styles.buttonText}>+ New Event</Text>
              </Pressable>
            )
          ) : null}

          {events.length === 0 ? (
            <Text style={styles.placeholder}>Nothing on the schedule yet.</Text>
          ) : (
            events.map((event) => (
              <View key={event.id} style={styles.eventCard}>
                <View style={styles.eventHeaderRow}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  {event.eventType ? <Text style={styles.eventType}>{event.eventType}</Text> : null}
                </View>
                <Text style={styles.eventWhen}>{formatEventWhen(event)}</Text>
                {event.location ? <Text style={styles.eventLocation}>📍 {event.location}</Text> : null}
                {event.notes ? <Text style={styles.eventNotes}>{event.notes}</Text> : null}
                <View style={styles.eventButtonRow}>
                  {addedToCalendarIds.has(event.id) ? (
                    <Text style={styles.eventAddedLabel}>✓ On your calendar</Text>
                  ) : (
                    <Pressable style={styles.eventLinkButton} onPress={() => handleAddToCalendar(event)}>
                      <Text style={styles.eventLink}>Add to my calendar</Text>
                    </Pressable>
                  )}
                  {isCoach ? (
                    <Pressable style={styles.eventLinkButton} onPress={() => handleDeleteEvent(event)}>
                      <Text style={styles.eventLinkDestructive}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  content: { padding: 20, gap: 12 },
  error: { color: '#C4362B', fontSize: 13, paddingHorizontal: 20, paddingTop: 8 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20, padding: 20, textAlign: 'center' },
  teamPicker: { flexGrow: 0, paddingHorizontal: 16, paddingTop: 12 },
  threadPicker: { flexGrow: 0, paddingHorizontal: 16, paddingTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#FFFFFF' },
  viewToggle: { flexDirection: 'row', padding: 16, gap: 8 },
  toggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  toggleButtonActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  toggleText: { fontSize: 14, fontWeight: '600', color: colors.text },
  toggleTextActive: { color: '#FFFFFF' },
  messageList: { padding: 16, gap: 8, flexGrow: 1 },
  pinnedCard: {
    backgroundColor: '#FFF8EA',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  pinnedLabel: { fontSize: 11, fontWeight: '700', color: colors.accentDark, marginBottom: 2 },
  messageBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    maxWidth: '85%',
  },
  messageBubbleMine: { backgroundColor: '#E6F4FE', alignSelf: 'flex-end', borderColor: colors.primary },
  replyBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    marginLeft: 24,
    marginBottom: 6,
    maxWidth: '75%',
  },
  messageAuthor: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, marginBottom: 2 },
  messageBody: { fontSize: 14, color: colors.text, lineHeight: 19 },
  messageMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  replyingText: { flex: 1, fontSize: 12, color: colors.textMuted, marginRight: 8 },
  replyingCancel: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    maxHeight: 100,
  },
  restrictedNotice: { fontSize: 13, color: colors.textMuted, textAlign: 'center', flex: 1 },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  sendButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  editCard: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#FFF8EA',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  noteInput: { minHeight: 70, textAlignVertical: 'top' },
  modalLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 4 },
  editButtonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  smallButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  smallButtonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  smallButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  smallButtonSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  eventCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
    gap: 4,
  },
  eventHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  eventType: { fontSize: 12, fontWeight: '600', color: colors.primary, textTransform: 'capitalize' },
  eventWhen: { fontSize: 13, color: colors.textMuted },
  eventLocation: { fontSize: 13, color: colors.textMuted },
  eventNotes: { fontSize: 13, color: colors.text, marginTop: 2 },
  eventButtonRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  eventLinkButton: {},
  eventLink: { fontSize: 13, fontWeight: '600', color: colors.primary },
  eventAddedLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  eventLinkDestructive: { fontSize: 13, fontWeight: '600', color: '#C4362B' },
});
