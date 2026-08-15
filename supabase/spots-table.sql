CREATE TABLE IF NOT EXISTS spots (
  name    text PRIMARY KEY,
  loc     text NOT NULL DEFAULT '',
  lat     double precision NOT NULL,
  lon     double precision NOT NULL,
  dirs    smallint[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true
);

ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
SELECT _drop_all_policies('spots');

CREATE POLICY "spots_select_all" ON spots FOR SELECT TO authenticated USING (true);
CREATE POLICY "spots_write_admin" ON spots FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS spots_active_idx ON spots (active);
