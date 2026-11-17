// Owner: add or edit a section (name, cover image), or delete it.
import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Button, Field, Message, Muted, Screen } from '../src/components/ui';
import { pickMedia, Thumb } from '../src/components/media';
import { useI18n } from '../src/i18n/I18nProvider';
import { deleteMedia, deleteSection, getSection, mediaStatus, saveSection } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { uploadAsset, type PickedAsset } from '../src/lib/upload';
import { themeFor } from '../src/theme/themes';

export default function SectionEdit() {
  const { t, tError } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const { org, home, profile } = useSession();
  const theme = themeFor(home?.theme_key);
  const [name, setName] = useState('');
  const [coverId, setCoverId] = useState<string | null>(null);
  const [originalCover, setOriginalCover] = useState<string | null>(null);
  const [coverStatus, setCoverStatus] = useState<string | undefined>();
  const [picked, setPicked] = useState<PickedAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: id ? t('sections.edit') : t('sections.add') });
    if (!id) return;
    getSection(id).then(async (s) => {
      if (!s) return;
      setName(s.name);
      setCoverId(s.cover_media_id);
      setOriginalCover(s.cover_media_id);
      if (s.cover_media_id) setCoverStatus((await mediaStatus([s.cover_media_id]))[s.cover_media_id]?.status);
    }).catch((err) => setError(tError(err)));
  }, [id, navigation, t, tError]);

  if (profile?.role !== 'owner' || !org) return null;

  async function choose() {
    const [a] = await pickMedia({ allowVideo: false, multiple: false, permissionText: t('media.permission') });
    if (a) { setPicked(a); setCoverId(null); }
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError(t('sections.nameHint'));
    setBusy(true);
    try {
      const cover = picked ? (await uploadAsset(picked)).id : coverId;
      await saveSection(org!.id, { id, name: name.trim(), cover_media_id: cover });
      if (originalCover && originalCover !== cover) await deleteMedia([originalCover]).catch(() => {});
      router.back();
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert(t('sections.delete'), t('sections.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive', onPress: async () => {
          try {
            await deleteSection(id!);
            if (originalCover) await deleteMedia([originalCover]).catch(() => {});
            router.back();
          } catch (err) {
            setError(tError(err));
          }
        },
      },
    ]);
  }

  const pendingLabel = coverStatus === 'pending' || coverStatus === 'approved' ? t('media.pending')
    : coverStatus === 'rejected' ? t('media.rejected') : undefined;

  return (
    <Screen theme={theme}>
      <Message text={error} />
      <Field theme={theme} label={t('sections.name')} hint={t('sections.nameHint')} value={name}
        onChangeText={setName} maxLength={60} autoFocus={!id} />
      <Muted theme={theme} style={{ fontWeight: '600' }}>{t('sections.cover')}</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {picked || coverId ? (
          <Thumb uri={picked?.uri} kind="image" theme={theme} status={coverStatus}
            statusLabel={picked ? undefined : pendingLabel}
            onRemove={() => { setPicked(null); setCoverId(null); }} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Button theme={theme} kind="secondary" label={t('edit.choose')} onPress={choose} />
        </View>
      </View>
      <Muted theme={theme}>{t('media.approvalNote')}</Muted>
      <Button theme={theme} label={t('common.save')} onPress={save} busy={busy} />
      {id ? <Button theme={theme} kind="danger" label={t('sections.delete')} onPress={remove} disabled={busy} /> : null}
    </Screen>
  );
}
