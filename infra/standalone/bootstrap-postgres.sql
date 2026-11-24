-- Run once as the PostgreSQL administrator on a fresh cluster; existing roles/databases fail closed.
-- Supply the three passwords through the administrator process environment, not command arguments.
\set ON_ERROR_STOP on
\getenv platform_password PORDEN_PLATFORM_DB_PASSWORD
\getenv merchant_password PORDEN_MERCHANT_DB_PASSWORD
\getenv courier_password PORDEN_COURIER_DB_PASSWORD

SELECT format('CREATE ROLE porden_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'platform_password') \gexec
SELECT format('CREATE ROLE porden_merchant LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'merchant_password') \gexec
SELECT format('CREATE ROLE porden_courier LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'courier_password') \gexec

CREATE DATABASE porden_platform OWNER porden_platform;
CREATE DATABASE porden_merchant OWNER porden_merchant;
CREATE DATABASE porden_courier OWNER porden_courier;
REVOKE CONNECT ON DATABASE porden_platform FROM PUBLIC;
REVOKE CONNECT ON DATABASE porden_merchant FROM PUBLIC;
REVOKE CONNECT ON DATABASE porden_courier FROM PUBLIC;
GRANT CONNECT ON DATABASE porden_platform TO porden_platform;
GRANT CONNECT ON DATABASE porden_merchant TO porden_merchant;
GRANT CONNECT ON DATABASE porden_courier TO porden_courier;
