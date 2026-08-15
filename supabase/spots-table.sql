CREATE TABLE IF NOT EXISTS spots (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name    text NOT NULL,
  loc     text NOT NULL DEFAULT '',
  lat     double precision NOT NULL,
  lon     double precision NOT NULL,
  dirs    smallint[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true,
  -- (name, loc) is the natural key, not name alone: two real spots share the
  -- name 'Surfers Paradise' (Koksijde, Belgium and Queensland, Australia).
  UNIQUE (name, loc)
);

ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
SELECT _drop_all_policies('spots');

CREATE POLICY "spots_select_all" ON spots FOR SELECT TO authenticated USING (true);
CREATE POLICY "spots_write_admin" ON spots FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS spots_active_idx ON spots (active);
