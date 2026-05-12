-- Seed a test user (email: test@example.com, password: password123)
insert into auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role
) values (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  'authenticated'
) on conflict (id) do nothing;

-- Seed some notes for the test user
insert into public.notes (user_id, title, body) values
  ('00000000-0000-0000-0000-000000000001', 'Welcome to 10x App', 'This is your first note. You can create, read, update and delete notes.'),
  ('00000000-0000-0000-0000-000000000001', 'Workshop notes', 'Built with Supabase + React + Vite during the Toronto AI Accelerator.');
