-- The default organization is now called MyRitmio (code "myritmio").
-- Only if it still has its original name, and nothing else uses the new name or code.
update public.organizations o
   set name = 'MyRitmio', join_code = 'myritmio'
 where o.is_default
   and o.name = 'YogaByTheSofa'
   and not exists (select 1 from public.organizations x
                    where x.id <> o.id and x.status <> 'closed'
                      and (lower(x.name) = 'myritmio' or x.join_code = 'myritmio'));
