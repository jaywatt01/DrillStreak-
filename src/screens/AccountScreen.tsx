import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { getMyDisplayName, setMyDisplayName } from '../lib/profile';
import { listMyTeams, listTeamContacts } from '../lib/teamMessages';
import { getPlayerTeams, leaveTeam } from '../lib/team';
import { AVAILABLE_SPORTS, deletePlayer, listMyPlayers, Player } from '../lib/players';
import { listBadges, Badge, filterCurrentBadges } from '../lib/badges';
import { getActiveSeason } from '../lib/seasons';
import BadgeLegend from '../components/BadgeLegend';
import BadgeIconStrip from '../components/BadgeIconStrip';
import ActionSheet, { ActionSheetOption } from '../components/ActionSheet';
import HelpModal from '../components/HelpModal';
import {
  isPurchasesConfigured,
  purchaseParentTier,
  restorePurchases,
  useParentEntitlement,
} from '../lib/purchases';
import { listMyInstitutionalTeams, InstitutionalTeam } from '../lib/institutionalAccess';
import { useActiveSport } from '../lib/ActiveSportContext';
import SportSwitcher from '../components/SportSwitcher';

export default function AccountScreen() {
  const navigation = useNavigation();
  const { sport: activeSport, loading: sportLoading } = useActiveSport();
  const [email, setEmail] = useState<string | null>(null);
  // Deliberately the raw RevenueCat signal only — NOT combined with
  // institutional (Team/Program) access like AddPlayerScreen/ProgressScreen/
  // the self-view modal are. This screen's "Active"/"Manage Subscription"/
  // "Restore Purchases" UI is specifically about a real purchased
  // subscription; showing "Manage Subscription" to someone whose access
  // comes only from a paid team roster would deep-link to Apple's
  // subscription settings showing nothing to manage. See
  // src/lib/institutionalAccess.ts for where institutional access is
  // actually checked.
  const { hasParentTier, loading: entitlementLoading } = useParentEntitlement();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [loadingName, setLoadingName] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [badgesByPlayer, setBadgesByPlayer] = useState<Record<string, { all: Badge[]; currentSeason: Badge[] }>>({});
  const [loadingBadges, setLoadingBadges] = useState(true);
  const [viewingBadgesFor, setViewingBadgesFor] = useState<Player | null>(null);
  // Empty by default and stays empty for the vast majority of accounts —
  // there's no self-serve signup for Team/Program plans, so this only
  // populates once Jay manually marks a team's institutional_plan active
  // via the Supabase SQL Editor after an invoice is paid. Render nothing
  // while it's empty, per Jay's explicit ask not to show this section
  // "all of the time."
  const [institutionalTeams, setInstitutionalTeams] = useState<InstitutionalTeam[]>([]);
  // Real ask, 2026-09-11: a parent with kids across 2-3 sports shouldn't
  // have to toggle the sport switcher just to see who plays what.
  // Deliberately unfiltered (every sport at once) — the one exception to
  // this whole screen's active-sport scoping, and the one place in the
  // app that's supposed to be. Badges/streaks/season deliberately left
  // off, per Jay's own call — this is just "who, what sport, what team,"
  // nothing that needs a season or a streak number attached.
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [teamsByPlayer, setTeamsByPlayer] = useState<Record<string, { id: string; name: string }[]>>({});
  const [loadingAllPlayers, setLoadingAllPlayers] = useState(true);
  // Coach/Parent/Program cards collapsed behind one tap by default
  // (2026-09-11, Jay's ask) — frees up room on the screen for the new
  // player roster and the existing badge section above it.
  const [billingExpanded, setBillingExpanded] = useState(false);
  // A Modal rather than a navigated screen (2026-09-12, real bug fix —
  // see HelpModal's own comment): the earlier hidden-tab version silently
  // ate 1/7 of the tab bar's width for nothing, visibly shifting the 6
  // real tabs off-center. Local state here since Account is the only
  // place Help ever opens from — no need for the app-wide context
  // ActiveSportContext's switcherOpen uses, which has two real trigger
  // points (the on-screen link and a tab long-press).
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    getMyDisplayName()
      .then((name) => setDisplayName(name ?? ''))
      .finally(() => setLoadingName(false));
    listMyInstitutionalTeams()
      .then(setInstitutionalTeams)
      .catch(() => setInstitutionalTeams([]));
    loadAllPlayers();
  }, []);

  // Factored out so the roster actions below (leave team, delete) can
  // re-sync this section after a real change instead of hand-mutating
  // local state and risking it drifting from the server.
  async function loadAllPlayers() {
    setLoadingAllPlayers(true);
    try {
      const all = await listMyPlayers();
      setAllPlayers(all);
      // Per-player try/catch — one player's team lookup failing (a rare
      // RLS/network hiccup) shouldn't blank out every other player's
      // team info too; that player just shows no team line instead.
      const entries = await Promise.all(
        all.map(async (p) => {
          try {
            return [p.id, await getPlayerTeams(p.id)] as const;
          } catch {
            return [p.id, []] as const;
          }
        })
      );
      setTeamsByPlayer(Object.fromEntries(entries));
    } finally {
      setLoadingAllPlayers(false);
    }
  }

  // Separate effect, depends on activeSport/sportLoading (2026-09-10) —
  // the badge roster is the one thing on this screen that's actually
  // sport-scoped; everything above (name, email, institutional teams) is
  // account-wide and only needs to load once.
  useEffect(() => {
    if (sportLoading) return;
    setLoadingBadges(true);
    listMyPlayers()
      .then(async (myPlayers) => {
        const sportPlayers = myPlayers.filter((p) => p.sport === activeSport);
        setPlayers(sportPlayers);
        const entries = await Promise.all(
          sportPlayers.map(async (p) => {
            const [all, activeSeason] = await Promise.all([listBadges(p.id), getActiveSeason(p.id)]);
            return [p.id, { all, currentSeason: filterCurrentBadges(all, activeSeason) }] as const;
          })
        );
        setBadgesByPlayer(Object.fromEntries(entries));
      })
      .finally(() => setLoadingBadges(false));
  }, [activeSport, sportLoading]);

  // Real ask, 2026-09-11: the new "Your Players" cards should be
  // long-press-able the same way MyTeamScreen's roster rows already are.
  // "Remove from Team" reuses the same team_memberships_access RLS the
  // coach's own removeFromRoster already relies on (see leaveTeam's
  // comment in lib/team.ts) — this is the guardian/player side of that
  // same permission, not a new capability.
  //
  // Real bug caught on-device, Android only, same day: this menu can
  // have 4 options (Edit Profile/Remove from Team/Delete/Cancel) once a
  // player is on a team — Alert.alert silently drops the 4th button on
  // Android, leaving no way to dismiss except completing Edit or Delete.
  // Routed through the new ActionSheet component instead (see its own
  // comment) rather than Alert.alert.
  const [actionSheetFor, setActionSheetFor] = useState<Player | null>(null);
  // Rare multi-team case (a player is normally on 0 or 1 team for a
  // given sport) — its own ActionSheet rather than guessing which team,
  // same reasoning as the main menu: an unbounded list of team names is
  // exactly the shape that broke on Android as a native Alert too.
  const [teamPickerFor, setTeamPickerFor] = useState<{ player: Player; teams: { id: string; name: string }[] } | null>(
    null
  );

  const handleLongPressAllPlayer = (player: Player) => setActionSheetFor(player);

  const actionSheetOptions = (player: Player): ActionSheetOption[] => {
    const teams = teamsByPlayer[player.id] ?? [];
    const options: ActionSheetOption[] = [
      {
        text: 'Edit Profile',
        onPress: () =>
          (navigation.navigate as (name: never, params?: object) => void)('Add a Player' as never, {
            editPlayerId: player.id,
          }),
      },
    ];
    if (teams.length > 0) {
      options.push({
        text: 'Remove from Team',
        style: 'destructive',
        onPress: () =>
          teams.length === 1 ? confirmRemoveFromTeam(player, teams[0].id, teams[0].name) : setTeamPickerFor({ player, teams }),
      });
    }
    options.push({ text: 'Delete', style: 'destructive', onPress: () => confirmDeletePlayer(player) });
    options.push({ text: 'Cancel', style: 'cancel' });
    return options;
  };

  // Plain 2-button Alert.alert confirms — safe on both platforms (the
  // Android button-count bug only bites at 4+), so no need to route
  // these through the custom ActionSheet too.
  const confirmRemoveFromTeam = (player: Player, teamId: string, teamName: string) => {
    Alert.alert(
      `Remove ${player.display_name} from ${teamName}?`,
      "They'll lose access to this team's assignments and Team Chat. A new invite code would be needed to rejoin.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveTeam(player.id, teamId);
              await loadAllPlayers();
            } catch (e) {
              Alert.alert('Could not remove from team', e instanceof Error ? e.message : 'Something went wrong.');
            }
          },
        },
      ]
    );
  };

  const confirmDeletePlayer = (player: Player) => {
    Alert.alert(
      `Delete ${player.display_name}?`,
      "This removes their profile and all their logged history. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlayer(player.id);
              await loadAllPlayers();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
            }
          },
        },
      ]
    );
  };

  // Soft check, not a hard gate: a display_name is one value per account,
  // shared across every team that account is on, so a strict app-wide
  // unique constraint isn't really coherent (two unrelated teams both
  // having a "Chris" isn't a real conflict). What actually matters is
  // whether it collides with someone on the SAME roster(s) this account
  // is actually part of — checked at save time against every team's
  // contact list, excluding the account's own existing entry.
  const checkNameCollision = async (trimmedName: string): Promise<boolean> => {
    const { data: userData } = await supabase.auth.getUser();
    const myUserId = userData.user?.id;
    const myTeams = await listMyTeams();
    const allContacts = (await Promise.all(myTeams.map((t) => listTeamContacts(t.id)))).flat();
    return allContacts.some(
      (c) => c.userId !== myUserId && c.label.trim().toLowerCase() === trimmedName.toLowerCase()
    );
  };

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      const trimmed = displayName.trim();
      const collision = trimmed ? await checkNameCollision(trimmed) : false;
      await setMyDisplayName(displayName);
      if (collision) {
        Alert.alert(
          'Name already in use',
          `Someone else on your team is already going by "${trimmed}" — consider adding a last initial or a name your team already knows you by, so people can tell you apart. Saved anyway.`
        );
      } else {
        Alert.alert('Saved', 'Your name will now show on Team Chat instead of a generic label.');
      }
    } catch (e) {
      Alert.alert('Could not save name', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingName(false);
    }
  };

  const handleUpgrade = async () => {
    setPurchasing(true);
    try {
      await purchaseParentTier();
      Alert.alert('You\'re upgraded!', 'Parent membership is active — full history and unlimited linked players are unlocked.');
    } catch (e) {
      Alert.alert('Could not complete purchase', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPurchasing(false);
    }
  };

  // Apple requires cancellation to go through the platform's own
  // subscription management, not the app itself — this deep-links
  // straight to the right screen instead of making someone hunt through
  // Settings. itms-apps:// is iOS-specific; falls back to the Play
  // Store's subscriptions list on Android, since RevenueCat/App Store is
  // the only storefront actually shipping today but this shouldn't go
  // dead if that ever changes.
  const handleManageSubscription = () => {
    const url =
      Platform.OS === 'ios'
        ? 'itms-apps://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open subscription settings', 'Open your device Settings app and look under Subscriptions.')
    );
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      const restored = info.entitlements.active['parent_tier'] != null;
      Alert.alert(restored ? 'Restored' : 'Nothing to restore', restored ? 'Parent membership is active on this account.' : 'No previous purchase was found for this account.');
    } catch (e) {
      Alert.alert('Could not restore purchases', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Account</Text>
      {email ? <Text style={styles.email}>{email}</Text> : null}
      <Text style={styles.placeholder}>
        Manage your Parent and Coach memberships independently — both can be
        active on the same account at once.
      </Text>
      <SportSwitcher />

      <View style={styles.nameCard}>
        <Text style={styles.tierLabel}>Your name</Text>
        <Text style={styles.tierBody}>
          Shown on Team Chat instead of a generic label like "Parent of Jayden" — helps a
          roster of 20-30 families tell who's who.
        </Text>
        {loadingName ? (
          <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        ) : (
          <>
            <TextInput
              style={styles.nameInput}
              placeholder="e.g. Mike Thompson"
              placeholderTextColor={colors.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
            />
            <Pressable
              style={[styles.button, savingName && styles.buttonDisabled]}
              onPress={handleSaveName}
              disabled={savingName}
            >
              {savingName ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Save name</Text>}
            </Pressable>
          </>
        )}
      </View>

      <Pressable style={styles.billingToggle} onPress={() => setHelpOpen(true)}>
        <Text style={styles.billingToggleText}>❓ Help & FAQ</Text>
        <Text style={styles.billingToggleChevron}>→</Text>
      </Pressable>
      <HelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} />

      {allPlayers.length > 0 ? (
        <View style={styles.badgesSection}>
          <Text style={styles.tierLabel}>Your Players</Text>
          <Text style={styles.tierBody}>
            Every player linked to your account, across every sport you're using. Long-press a
            player for options.
          </Text>
          {loadingAllPlayers ? (
            <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
          ) : (
            allPlayers.map((p) => (
              <Pressable
                key={p.id}
                style={styles.badgeRosterRow}
                onLongPress={() => handleLongPressAllPlayer(p)}
              >
                <View style={styles.badgeRosterTopRow}>
                  <Text style={styles.badgeRosterName}>{p.display_name}</Text>
                  <Text style={styles.sportTag}>
                    {AVAILABLE_SPORTS.find((s) => s.value === p.sport)?.label ?? p.sport}
                  </Text>
                </View>
                {teamsByPlayer[p.id]?.length ? (
                  <Text style={styles.rosterTeamName}>{teamsByPlayer[p.id].map((t) => t.name).join(', ')}</Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <ActionSheet
        visible={actionSheetFor != null}
        title={actionSheetFor?.display_name ?? ''}
        message="What would you like to do?"
        options={actionSheetFor ? actionSheetOptions(actionSheetFor) : []}
        onClose={() => setActionSheetFor(null)}
      />
      <ActionSheet
        visible={teamPickerFor != null}
        title={teamPickerFor ? `Remove ${teamPickerFor.player.display_name} from which team?` : ''}
        options={
          teamPickerFor
            ? [
                ...teamPickerFor.teams.map((t) => ({
                  text: t.name,
                  onPress: () => confirmRemoveFromTeam(teamPickerFor.player, t.id, t.name),
                })),
                { text: 'Cancel', style: 'cancel' as const },
              ]
            : []
        }
        onClose={() => setTeamPickerFor(null)}
      />

      {players.length > 0 ? (
        <View style={styles.badgesSection}>
          <Text style={styles.tierLabel}>Badges</Text>
          <Text style={styles.tierBody}>For your currently active sport only — switch sports above to see another.</Text>
          {loadingBadges ? (
            <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
          ) : (
            // Roster-style compact rows (2026-08-25, Jay-requested) — the
            // full 6-card BadgeLegend grid repeated per player meant a lot
            // of scrolling with 3+ kids on one account. Same relationship
            // MyTeamScreen's roster rows have to CoachPlayerStatsModal: a
            // compact row here (name + icon strip), tap through for the
            // full legend with "how to earn" text and lifetime counts.
            players.map((p) => (
              <Pressable key={p.id} style={styles.badgeRosterRow} onPress={() => setViewingBadgesFor(p)}>
                <View style={styles.badgeRosterTopRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.badgeRosterName}>{p.display_name}</Text>
                    <Text style={styles.sportTag}>
                      {AVAILABLE_SPORTS.find((s) => s.value === p.sport)?.label ?? p.sport}
                    </Text>
                  </View>
                  <Text style={styles.badgeRosterLink}>View →</Text>
                </View>
                <BadgeIconStrip
                  currentSeasonBadges={badgesByPlayer[p.id]?.currentSeason ?? []}
                  allBadges={badgesByPlayer[p.id]?.all ?? []}
                  sport={p.sport}
                />
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <Modal
        visible={viewingBadgesFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingBadgesFor(null)}
      >
        <View style={styles.badgeModalOverlay}>
          <View style={styles.badgeModalCard}>
            <View style={styles.badgeRosterTopRow}>
              <Text style={styles.tierValue}>{viewingBadgesFor?.display_name}</Text>
              <Pressable onPress={() => setViewingBadgesFor(null)} hitSlop={8}>
                <Text style={styles.badgeRosterLink}>Close</Text>
              </Pressable>
            </View>
            <ScrollView>
              {viewingBadgesFor ? (
                <BadgeLegend
                  currentSeasonBadges={badgesByPlayer[viewingBadgesFor.id]?.currentSeason ?? []}
                  allBadges={badgesByPlayer[viewingBadgesFor.id]?.all ?? []}
                  sport={viewingBadgesFor.sport}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Pressable style={styles.billingToggle} onPress={() => setBillingExpanded((v) => !v)}>
        <Text style={styles.billingToggleText}>💳 Billing & Memberships</Text>
        <Text style={styles.billingToggleChevron}>{billingExpanded ? '▲' : '▼'}</Text>
      </Pressable>

      {billingExpanded ? (
        <>
      <View style={styles.tierCard}>
        <Text style={styles.tierLabel}>Coach</Text>
        <Text style={styles.tierValue}>Free — always included</Text>
        <Text style={styles.tierBody}>
          Create a team, assign drills, and manage your roster at no cost.
        </Text>
      </View>

      <View style={[styles.tierCard, hasParentTier && styles.tierCardActive]}>
        <Text style={styles.tierLabel}>Parent</Text>
        {entitlementLoading ? (
          <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        ) : (
          <Text style={styles.tierValue}>{hasParentTier ? 'Active' : '$4.99/mo'}</Text>
        )}
        <Text style={styles.tierBody}>
          Full progress history and unlimited linked players. Free accounts
          see the current week only, for one linked player.
        </Text>

        {!hasParentTier && !entitlementLoading ? (
          <Pressable
            style={[styles.button, purchasing && styles.buttonDisabled]}
            onPress={handleUpgrade}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>
                {isPurchasesConfigured() ? 'Upgrade — $4.99/mo' : 'Upgrade (coming soon)'}
              </Text>
            )}
          </Pressable>
        ) : null}

        {!hasParentTier ? (
          <Pressable onPress={handleRestore} disabled={restoring} style={styles.restoreLink}>
            {restoring ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.restoreLinkText}>Restore purchases</Text>
            )}
          </Pressable>
        ) : null}

        {hasParentTier && !entitlementLoading ? (
          <Pressable style={styles.manageButton} onPress={handleManageSubscription}>
            <Text style={styles.manageButtonText}>Manage Subscription</Text>
          </Pressable>
        ) : null}

        {/* Apple App Review guideline 3.1.2 subscription disclosure —
            required near the purchase button, only while it's showing. */}
        {!hasParentTier && !entitlementLoading ? (
          <Text style={styles.disclosureText}>
            Parent Membership is a $4.99/month auto-renewing subscription.
            Payment is charged to your Apple ID account at confirmation of
            purchase. The subscription automatically renews unless
            auto-renew is turned off at least 24 hours before the end of
            the current period, and your account will be charged for
            renewal within 24 hours prior to that. Manage or cancel
            anytime in your device's Apple ID account settings.{' '}
            <Text
              style={styles.disclosureLink}
              onPress={() => Linking.openURL('https://legal.drillstreak.com/legal/terms-of-service.html')}
            >
              Terms of Service
            </Text>
            {'  ·  '}
            <Text
              style={styles.disclosureLink}
              onPress={() => Linking.openURL('https://legal.drillstreak.com/legal/privacy-policy.html')}
            >
              Privacy Policy
            </Text>
          </Text>
        ) : null}
      </View>

      {institutionalTeams.map((team) => (
        <View key={team.teamId} style={[styles.tierCard, styles.tierCardActive]}>
          <Text style={styles.tierLabel}>Program</Text>
          <Text style={styles.tierValue}>{team.teamName}</Text>
          <Text style={styles.tierBody}>
            {team.plan === 'program' ? 'Program plan' : 'Team plan'} — active
            {team.role === 'coach' ? ' for your team' : ' for your family'}.
            {team.expiresAt
              ? ` Renews ${new Date(team.expiresAt).toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}.`
              : ''}{' '}
            Full history and unlimited linked players are unlocked for every player on this
            roster — no separate Parent membership needed.
          </Text>
        </View>
      ))}
        </>
      ) : null}

      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  email: { fontSize: 14, color: colors.textMuted },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  tierCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 4,
    backgroundColor: colors.surface,
  },
  nameCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 4,
    backgroundColor: colors.surface,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
    marginTop: 8,
  },
  badgesSection: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    backgroundColor: colors.surface,
  },
  badgeRosterRow: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  badgeRosterTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgeRosterName: { fontSize: 15, fontWeight: '600', color: colors.text },
  sportTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeRosterLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
  rosterTeamName: { fontSize: 12, color: colors.textMuted },
  billingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  billingToggleText: { fontSize: 15, fontWeight: '600', color: colors.text },
  billingToggleChevron: { fontSize: 13, color: colors.textMuted },
  badgeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  badgeModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
    gap: 12,
  },
  tierCardActive: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
  },
  tierLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  tierValue: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 2 },
  tierBody: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginTop: 4 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  restoreLink: { alignSelf: 'center', marginTop: 10 },
  restoreLinkText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  manageButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  manageButtonText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  disclosureText: { fontSize: 11, color: colors.textMuted, lineHeight: 16, marginTop: 12 },
  disclosureLink: { color: colors.primary, fontWeight: '600' },
  signOutButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#C4362B', fontSize: 15, fontWeight: '600' },
});
