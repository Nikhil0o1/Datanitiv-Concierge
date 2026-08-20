-- pgBoss job queue schema — from cape-pg-data.sql
CREATE SCHEMA IF NOT EXISTS pgboss;

DROP TABLE IF EXISTS pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea CASCADE;
DROP TABLE IF EXISTS pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 CASCADE;
DROP TABLE IF EXISTS pgboss.archive CASCADE;
DROP TABLE IF EXISTS pgboss.subscription CASCADE;
DROP TABLE IF EXISTS pgboss.schedule CASCADE;
DROP TABLE IF EXISTS pgboss.job CASCADE;
DROP TABLE IF EXISTS pgboss.queue CASCADE;
DROP TABLE IF EXISTS pgboss.version CASCADE;
DROP TYPE IF EXISTS pgboss.job_state CASCADE;

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);

CREATE TABLE pgboss.version (
    version int4 NOT NULL,
    maintained_on timestamptz,
    cron_on timestamptz,
    monitored_on timestamptz,
    PRIMARY KEY (version)
);

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text,
    retry_limit int4,
    retry_delay int4,
    retry_backoff bool,
    expire_seconds int4,
    retention_minutes int4,
    dead_letter text,
    partition_name text,
    created_on timestamptz NOT NULL DEFAULT now(),
    updated_on timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (name)
);

CREATE TABLE pgboss.job (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    priority int4 NOT NULL DEFAULT 0,
    data jsonb,
    state pgboss.job_state NOT NULL DEFAULT 'created'::pgboss.job_state,
    retry_limit int4 NOT NULL DEFAULT 2,
    retry_count int4 NOT NULL DEFAULT 0,
    retry_delay int4 NOT NULL DEFAULT 0,
    retry_backoff bool NOT NULL DEFAULT false,
    start_after timestamptz NOT NULL DEFAULT now(),
    started_on timestamptz,
    singleton_key text,
    singleton_on timestamp,
    expire_in interval NOT NULL DEFAULT '00:15:00'::interval,
    created_on timestamptz NOT NULL DEFAULT now(),
    completed_on timestamptz,
    keep_until timestamptz NOT NULL DEFAULT (now() + '14 days'::interval),
    output jsonb,
    dead_letter text,
    policy text,
    PRIMARY KEY (name, id)
);

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    cron text NOT NULL,
    timezone text,
    data jsonb,
    options jsonb,
    created_on timestamptz NOT NULL DEFAULT now(),
    updated_on timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (name)
);

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamptz NOT NULL DEFAULT now(),
    updated_on timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event, name)
);

CREATE TABLE pgboss.archive (
    id uuid NOT NULL,
    name text NOT NULL,
    priority int4 NOT NULL,
    data jsonb,
    state pgboss.job_state NOT NULL,
    retry_limit int4 NOT NULL,
    retry_count int4 NOT NULL,
    retry_delay int4 NOT NULL,
    retry_backoff bool NOT NULL,
    start_after timestamptz NOT NULL,
    started_on timestamptz,
    singleton_key text,
    singleton_on timestamp,
    expire_in interval NOT NULL,
    created_on timestamptz NOT NULL,
    completed_on timestamptz,
    keep_until timestamptz NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    archived_on timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (name, id)
);

CREATE TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (name = '__pgboss__send-it'::text),
    priority int4 NOT NULL DEFAULT 0,
    data jsonb,
    state pgboss.job_state NOT NULL DEFAULT 'created'::pgboss.job_state,
    retry_limit int4 NOT NULL DEFAULT 2,
    retry_count int4 NOT NULL DEFAULT 0,
    retry_delay int4 NOT NULL DEFAULT 0,
    retry_backoff bool NOT NULL DEFAULT false,
    start_after timestamptz NOT NULL DEFAULT now(),
    started_on timestamptz,
    singleton_key text,
    singleton_on timestamp,
    expire_in interval NOT NULL DEFAULT '00:15:00'::interval,
    created_on timestamptz NOT NULL DEFAULT now(),
    completed_on timestamptz,
    keep_until timestamptz NOT NULL DEFAULT (now() + '14 days'::interval),
    output jsonb,
    dead_letter text,
    policy text,
    PRIMARY KEY (name, id)
);

CREATE TABLE pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (name = '__pgboss__send-it'::text),
    priority int4 NOT NULL DEFAULT 0,
    data jsonb,
    state pgboss.job_state NOT NULL DEFAULT 'created'::pgboss.job_state,
    retry_limit int4 NOT NULL DEFAULT 2,
    retry_count int4 NOT NULL DEFAULT 0,
    retry_delay int4 NOT NULL DEFAULT 0,
    retry_backoff bool NOT NULL DEFAULT false,
    start_after timestamptz NOT NULL DEFAULT now(),
    started_on timestamptz,
    singleton_key text,
    singleton_on timestamp,
    expire_in interval NOT NULL DEFAULT '00:15:00'::interval,
    created_on timestamptz NOT NULL DEFAULT now(),
    completed_on timestamptz,
    keep_until timestamptz NOT NULL DEFAULT (now() + '14 days'::interval),
    output jsonb,
    dead_letter text,
    policy text,
    PRIMARY KEY (name, id)
);

ALTER TABLE pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);

ALTER TABLE pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;

ALTER TABLE pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;

ALTER TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_name_fkey
    FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT;

ALTER TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_dead_letter_fkey
    FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT;

ALTER TABLE pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    ADD CONSTRAINT jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_name_fkey
    FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT;

ALTER TABLE pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    ADD CONSTRAINT jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_dead_letter_fkey
    FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT;

CREATE INDEX archive_i1 ON pgboss.archive USING btree (archived_on);

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1
    ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    USING btree (name, COALESCE(singleton_key, ''::text))
    WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2
    ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    USING btree (name, COALESCE(singleton_key, ''::text))
    WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3
    ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    USING btree (name, state, COALESCE(singleton_key, ''::text))
    WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4
    ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    USING btree (name, singleton_on, COALESCE(singleton_key, ''::text))
    WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5
    ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    USING btree (name, start_after) INCLUDE (priority, created_on, id)
    WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_i1
    ON pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    USING btree (name, COALESCE(singleton_key, ''::text))
    WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_i2
    ON pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    USING btree (name, COALESCE(singleton_key, ''::text))
    WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_i3
    ON pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    USING btree (name, state, COALESCE(singleton_key, ''::text))
    WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_i4
    ON pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    USING btree (name, singleton_on, COALESCE(singleton_key, ''::text))
    WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea_i5
    ON pgboss.jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea
    USING btree (name, start_after) INCLUDE (priority, created_on, id)
    WHERE (state < 'active'::pgboss.job_state);
