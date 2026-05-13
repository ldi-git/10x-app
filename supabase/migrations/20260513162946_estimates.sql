CREATE TABLE public.estimates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bfe_number       bigint NOT NULL,
  address_text     text NOT NULL,
  estimated_price  numeric NOT NULL,
  price_per_m2     numeric NOT NULL,
  comparable_count int NOT NULL,
  living_area_m2   numeric,
  build_year       int,
  building_use     int,
  municipality_code varchar(4),
  interest_rate    numeric,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner only"
  ON public.estimates
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX estimates_user_created
  ON public.estimates (user_id, created_at DESC);
