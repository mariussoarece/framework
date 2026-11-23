-- Push tokens. A phone keeps the same token when another person signs in on it,
-- so registering moves the token to the person now signed in (a plain insert would
-- be refused, because the row still belongs to the previous user).
create or replace function public.register_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app.uid() is null then
    raise exception 'login_required';
  end if;
  if p_platform not in ('ios', 'android') or coalesce(length(p_token), 0) not between 10 and 4096 then
    raise exception 'invalid_device';
  end if;
  insert into public.devices (push_token, user_id, platform, updated_at)
  values (p_token, app.uid(), p_platform, now())
  on conflict (push_token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke all on function public.register_device(text, text) from public;
grant execute on function public.register_device(text, text) to authenticated;
