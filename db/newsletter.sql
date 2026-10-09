CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
 email text PRIMARY KEY CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','withdrawn')),
 consent_text text NOT NULL,
 consent_version text NOT NULL,
 source text NOT NULL CHECK (source='homepage'),
 requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_subscription_attempts (
 key text PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
