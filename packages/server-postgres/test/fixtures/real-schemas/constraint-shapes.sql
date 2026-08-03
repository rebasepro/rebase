-- Every CHECK-constraint shape the introspection parser claims to read, and a
-- set it must refuse to read, declared so that a real PostgreSQL server
-- normalizes them.
--
-- The parser reads `pg_get_constraintdef` output, which is re-rendered by the
-- server from its parse tree and looks nothing like what is written below:
-- `CHECK (price > 0)` on a numeric column comes back as
-- `CHECK ((price > (0)::numeric))`. Writing the expected strings by hand would
-- test the parser against a guess at that rendering. This file is loaded into a
-- real server and the *server's* rendering is captured — see
-- `scripts/capture-constraint-fixture.ts` and `constraint-shapes.json`.
--
-- The rejected shapes matter as much as the accepted ones. A parser that reads
-- half of `start_date < end_date` produces validation the database does not
-- have.

CREATE TABLE constraint_shapes (
    id integer PRIMARY KEY,

    -- ── Numeric bounds ────────────────────────────────────────────────
    price numeric NOT NULL CHECK (price > 0),
    discount real CHECK (discount >= 0 AND discount <= 1),
    quantity integer CHECK (quantity >= 1),
    rating smallint CHECK (rating >= 1 AND rating <= 5),
    temperature integer CHECK (temperature > -50 AND temperature < 60),
    exact_count integer CHECK (exact_count = 42),
    percent numeric(5,2) CHECK (percent >= 0.00 AND percent <= 100.00),

    -- ── Closed value sets ─────────────────────────────────────────────
    status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
    tier varchar(20) CHECK (tier IN ('free', 'pro', 'enterprise')),
    visibility text CHECK (visibility = ANY (ARRAY['public', 'private'])),
    pinned_kind text CHECK (pinned_kind = 'only-one'),
    apostrophe_set text CHECK (apostrophe_set IN ('it''s', 'won''t')),

    -- ── String length ─────────────────────────────────────────────────
    code text CHECK (char_length(code) <= 10),
    slug text CHECK (length(slug) >= 3 AND length(slug) <= 64),
    fixed_len text CHECK (length(fixed_len) = 8),

    -- ── Shapes the parser must refuse ─────────────────────────────────
    -- Two columns: constrains their relationship, not either one's range.
    start_day integer,
    end_day integer CHECK (start_day < end_day),
    -- A disjunction narrows nothing: each branch allows what the other forbids.
    either_way integer CHECK (either_way < 0 OR either_way > 100),
    -- Not an equality or a range at all.
    email text CHECK (email LIKE '%@%'),
    payload jsonb CHECK (jsonb_typeof(payload) = 'object'),
    -- Negative membership: says what is disallowed, which no validation
    -- rule here expresses.
    not_reserved text CHECK (not_reserved <> ALL (ARRAY['admin', 'root'])),

    -- ── Other catalog facts read alongside checks ─────────────────────
    email_unique text UNIQUE,
    search tsvector,
    computed_total numeric GENERATED ALWAYS AS (price * 2) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT quantity_upper_bound CHECK (quantity <= 1000),
    CONSTRAINT status_not_legacy CHECK (status IN ('draft', 'published', 'archived', 'legacy'))
);

COMMENT ON TABLE constraint_shapes IS 'Every CHECK shape the parser is expected to handle.';
COMMENT ON COLUMN constraint_shapes.price IS 'Unit price, before tax.';
COMMENT ON COLUMN constraint_shapes.status IS 'Publication state.';

-- A child whose ownership is stated in the database rather than inferred.
CREATE TABLE constraint_shapes_child (
    id integer PRIMARY KEY,
    parent_id integer NOT NULL REFERENCES constraint_shapes (id) ON DELETE CASCADE,
    note text
);
