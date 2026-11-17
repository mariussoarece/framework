// Owner: the "+ Add workout" form (also used to edit).
// Name, sets, repetitions OR time, rest, rich-text description, pictures/videos,
// warning, what to avoid, and which sections show it.
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Button, Choice, Field, Message, Muted, Screen } from '../src/components/ui';
import { pickMedia, Thumb } from '../src/components/media';
import { RichEditor, editorDoc, useRichEditor } from '../src/components/RichEditor';
import { useI18n } from '../src/i18n/I18nProvider';
import {
  deleteMedia, deleteWorkout, getWorkout, listSections, saveWorkout, workoutMedia, workoutSectionIds,
  type Section, type Workout,
} from '../src/lib/data';
import { positiveInt } from '../src/lib/format';
import { useSession } from '../src/lib/session';
import { uploadAsset, type MediaRow, type PickedAsset } from '../src/lib/upload';
import type { RichDoc } from '../src/lib/types';
import { themeFor } from '../src/theme/themes';

type Mode = 'reps' | 'time';

export default function WorkoutEdit() {
  const { id, section } = useLocalSearchParams<{ id?: string; section?: string }>();
  const { t, tError } = useI18n();
  const { org, home, profile } = useSession();
  const navigation = useNavigation();
  const theme = themeFor(home?.theme_key);

  const [loaded, setLoaded] = useState(!id);
  const [initialDoc, setInitialDoc] = useState<RichDoc | null>(null);
  const [name, setName] = useState('');
  const [sets, setSets] = useState('3');
  const [mode, setMode] = useState<Mode>('reps');
  const [reps, setReps] = useState('10');
  const [time, setTime] = useState('30');
  const [rest, setRest] = useState('30');
  const [warning, setWarning] = useState('');
  const [avoid, setAvoid] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [chosen, setChosen] = useState<string[]>(section ? [section] : []);
  const [existing, setExisting] = useState<MediaRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: id ? t('common.edit') : t('workouts.add') });
    listSections().then(setSections).catch((err) => setError(tError(err)));
    if (!id) return;
    (async () => {
      try {
        const w = await getWorkout(id);
        if (!w) return;
        setName(w.name);
        setSets(String(w.sets ?? 1));
        if (w.duration_seconds) { setMode('time'); setTime(String(w.duration_seconds)); } else setReps(String(w.reps ?? ''));
        setRest(String(w.rest_seconds ?? 0));
        setWarning(w.warning ?? '');
        setAvoid(w.avoid ?? '');
        setInitialDoc(w.description);
        setChosen(await workoutSectionIds(id));
        setExisting(await workoutMedia(id));
      } catch (err) {
        setError(tError(err));
      } finally {
        setLoaded(true);
      }
    })();
  }, [id, navigation, t, tError]);

  if (profile?.role !== 'owner' || !org) return null;
  // the editor is created once with its starting content, so wait for the workout to load
  if (!loaded) return <Screen theme={theme}><Muted theme={theme}>{t('common.loading')}</Muted></Screen>;
  return (
    <Form
      {...{ id, org: org.id, theme, t, tError, name, setName, sets, setSets, mode, setMode, reps, setReps, time, setTime,
        rest, setRest, warning, setWarning, avoid, setAvoid, sections, chosen, setChosen, existing, removed, setRemoved,
        picked, setPicked, busy, setBusy, progress, setProgress, error, setError, initialDoc }}
    />
  );
}

type FormProps = {
  id?: string; org: string; theme: ReturnType<typeof themeFor>;
  t: ReturnType<typeof useI18n>['t']; tError: ReturnType<typeof useI18n>['tError'];
  name: string; setName: (v: string) => void; sets: string; setSets: (v: string) => void;
  mode: Mode; setMode: (m: Mode) => void; reps: string; setReps: (v: string) => void;
  time: string; setTime: (v: string) => void; rest: string; setRest: (v: string) => void;
  warning: string; setWarning: (v: string) => void; avoid: string; setAvoid: (v: string) => void;
  sections: Section[]; chosen: string[]; setChosen: (v: string[]) => void;
  existing: MediaRow[]; removed: string[]; setRemoved: (v: string[]) => void;
  picked: PickedAsset[]; setPicked: (v: PickedAsset[]) => void;
  busy: boolean; setBusy: (v: boolean) => void; progress: string | null; setProgress: (v: string | null) => void;
  error: string | null; setError: (v: string | null) => void; initialDoc: RichDoc | null;
};

function Form(p: FormProps) {
  const { t, theme } = p;
  const editor = useRichEditor(p.initialDoc);

  const statusLabel = (m: MediaRow) =>
    m.status === 'pending' || m.status === 'approved' ? t('media.pending')
      : m.status === 'rejected' ? t('media.rejected') : undefined;

  async function addMedia() {
    const assets = await pickMedia({ allowVideo: true, multiple: true, permissionText: t('media.permission') });
    if (assets.length) p.setPicked([...p.picked, ...assets]);
  }

  function toggleSection(sid: string) {
    p.setChosen(p.chosen.includes(sid) ? p.chosen.filter((x) => x !== sid) : [...p.chosen, sid]);
  }

  async function save() {
    p.setError(null);
    const setsN = positiveInt(p.sets);
    const repsN = p.mode === 'reps' ? positiveInt(p.reps) : null;
    const timeN = p.mode === 'time' ? positiveInt(p.time) : null;
    const restN = p.rest.trim() === '' ? 0 : positiveInt(p.rest, true);
    if (!p.name.trim()) return p.setError(t('workout.invalidName'));
    if (setsN === null || restN === null || (p.mode === 'reps' ? repsN === null : timeN === null)) {
      return p.setError(t('workout.invalidNumbers'));
    }
    if (!p.chosen.length) return p.setError(t('workout.needSection'));

    p.setBusy(true);
    try {
      const input: Omit<Workout, 'id' | 'organization_id'> = {
        name: p.name.trim(),
        sets: setsN,
        reps: repsN,
        duration_seconds: timeN,
        rest_seconds: restN,
        description: await editorDoc(editor),
        warning: p.warning.trim() || null,
        avoid: p.avoid.trim() || null,
      };
      const w = await saveWorkout(p.org, p.id ?? null, input, p.chosen);

      if (p.removed.length) await deleteMedia(p.removed);
      for (let i = 0; i < p.picked.length; i += 1) {
        await uploadAsset(p.picked[i], {
          workoutId: w.id,
          onProgress: (f) => p.setProgress(t('media.uploading', {
            current: i + 1, total: p.picked.length, percent: Math.round(f * 100),
          })),
        });
      }
      router.back();
    } catch (err) {
      p.setError(p.tError(err));
    } finally {
      p.setBusy(false);
      p.setProgress(null);
    }
  }

  function remove() {
    Alert.alert(t('workout.delete'), t('workout.deleteConfirm', { name: p.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive', onPress: async () => {
          try {
            await deleteWorkout(p.id!);
            router.dismissTo('/workouts');   // the workout's own screen no longer exists
          } catch (err) {
            p.setError(p.tError(err));
          }
        },
      },
    ]);
  }

  const numberField = (label: string, value: string, set: (v: string) => void) => (
    <View style={styles.numberField}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <TextInput value={value} onChangeText={(v) => set(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
        maxLength={4} style={[styles.number, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface }]} />
    </View>
  );

  const shownExisting = p.existing.filter((m) => !p.removed.includes(m.id));

  return (
    <Screen theme={theme}>
      <Message text={p.error} />

      <Field theme={theme} label={t('workout.name')} hint={t('workout.nameHint')} value={p.name}
        onChangeText={p.setName} maxLength={80} />

      {numberField(t('workout.sets'), p.sets, p.setSets)}

      <Text style={[styles.label, { color: theme.text }]}>{t('workout.mode')}</Text>
      <View style={styles.segment}>
        {(['reps', 'time'] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => p.setMode(m)} accessibilityRole="radio"
            accessibilityState={{ selected: p.mode === m }}
            style={[styles.segmentItem, {
              backgroundColor: p.mode === m ? theme.primary : theme.surface,
              borderColor: theme.primary,
            }]}>
            <Text style={{ color: p.mode === m ? theme.onPrimary : theme.primary, fontWeight: '700', fontSize: 16 }}>
              {m === 'reps' ? t('workout.modeReps') : t('workout.modeTime')}
            </Text>
          </Pressable>
        ))}
      </View>
      {p.mode === 'reps'
        ? numberField(t('workout.reps'), p.reps, p.setReps)
        : numberField(t('workout.time'), p.time, p.setTime)}

      {numberField(t('workout.rest'), p.rest, p.setRest)}

      <Text style={[styles.label, { color: theme.text }]}>{t('workout.description')}</Text>
      <RichEditor editor={editor} theme={theme} height={220} />

      <Text style={[styles.label, { color: theme.text }]}>{t('workout.media')}</Text>
      <View style={styles.thumbs}>
        {shownExisting.map((m) => (
          <Thumb key={m.id} kind={m.kind} theme={theme} status={m.status} statusLabel={statusLabel(m)}
            onRemove={() => p.setRemoved([...p.removed, m.id])} />
        ))}
        {p.picked.map((a, i) => (
          <Thumb key={`${a.uri}-${i}`} uri={a.uri} kind={a.kind} theme={theme}
            onRemove={() => p.setPicked(p.picked.filter((_, j) => j !== i))} />
        ))}
      </View>
      <Button theme={theme} kind="secondary" label={t('media.add')} onPress={addMedia} disabled={p.busy} />
      <Muted theme={theme}>{t('media.approvalNote')}</Muted>

      <Field theme={theme} label={t('workout.warning')} hint={t('workout.warningHint')} value={p.warning}
        onChangeText={p.setWarning} multiline maxLength={1000} />
      <Field theme={theme} label={t('workout.avoid')} hint={t('workout.avoidHint')} value={p.avoid}
        onChangeText={p.setAvoid} multiline maxLength={1000} />

      <Text style={[styles.label, { color: theme.text }]}>{t('workout.sections')}</Text>
      {p.sections.map((s) => (
        <Choice key={s.id} theme={theme} title={s.name} selected={p.chosen.includes(s.id)} onPress={() => toggleSection(s.id)} />
      ))}

      {p.progress ? <Message kind="info" text={p.progress} /> : null}
      <Button theme={theme} label={t('workout.save')} onPress={save} busy={p.busy} />
      {p.id ? <Button theme={theme} kind="danger" label={t('workout.delete')} onPress={remove} disabled={p.busy} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600' },
  numberField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  number: { width: 96, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 18, textAlign: 'center' },
  segment: { flexDirection: 'row', gap: 10 },
  segmentItem: { flex: 1, borderWidth: 2, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
