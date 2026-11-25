"""Verify the single standalone Compose stack in a unique disposable local project."""
import base64
import datetime
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]


def run_release_check():
    project = 'porden-release-' + uuid.uuid4().hex[:12]
    directory = ROOT / 'tmp' / project
    certificates = directory / 'certs'
    certificates.mkdir(parents=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    for role in ['platform', 'merchant', 'courier']:
        key = ec.generate_private_key(ec.SECP256R1())
        (certificates / (role + '-key.pem')).write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    wrong_key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Untrusted test CA')])
    wrong_ca = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(wrong_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1)).not_valid_after(now + datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(wrong_key, hashes.SHA256()))
    (certificates / 'wrong-ca.pem').write_bytes(wrong_ca.public_bytes(serialization.Encoding.PEM))
    with socket.socket() as first, socket.socket() as second:
        first.bind(('127.0.0.1', 0)); second.bind(('127.0.0.1', 0))
        http_port, https_port = first.getsockname()[1], second.getsockname()[1]
    values = {
        'PORDEN_API_IMAGE': 'porden-api:release-candidate',
        'PLATFORM_DOMAIN': 'api.porden.test', 'MERCHANT_DOMAIN': 'merchant.porden.test', 'COURIER_DOMAIN': 'courier.porden.test',
        'ACME_EMAIL': 'release@example.com', 'CADDY_TLS_ISSUER': 'internal',
        # Model calls are scripted inside the browser check; no provider is contacted.
        'OPENROUTER_API_KEY': 'scripted-not-a-key', 'OPENROUTER_MODEL': 'porden-scripted-test',
        'PORDEN_LISTEN_IP': '127.0.0.1', 'PORDEN_HTTP_PORT': str(http_port), 'PORDEN_HTTPS_PORT': str(https_port),
        'MERCHANT_ORGANIZATION_ID': str(uuid.uuid4()), 'COURIER_ORGANIZATION_ID': str(uuid.uuid4()),
        'PARTNER_SECRET': secrets.token_hex(32), 'POSTGRES_PASSWORD': secrets.token_hex(32),
        'TEST_HUMAN_PASSWORD': secrets.token_hex(24),
    }
    for role in ['platform', 'merchant', 'courier']:
        upper = role.upper()
        values[upper + '_DB_PASSWORD'] = secrets.token_hex(32)
        values[upper + '_DATABASE_URL'] = f'postgres://porden_{role}:{values[upper + "_DB_PASSWORD"]}@postgres:5432/porden_{role}?sslmode=disable'
        values[upper + '_SESSION_SECRET'] = secrets.token_hex(32)
        values[upper + '_SIGNING_KEY_FILE'] = (certificates / (role + '-key.pem')).as_posix()
        values[upper + '_SIGNING_KEY_ID'] = 'release-' + role
        if role != 'platform':
            values[upper + '_INTEGRATION_TOKEN'] = secrets.token_urlsafe(32)
            values[upper + '_DEMO_PASSWORD'] = secrets.token_hex(24)
    provisioning = {'organizations': [
        {'id': values['MERCHANT_ORGANIZATION_ID'], 'name': 'Release merchant', 'humanApprovalRequired': True},
        {'id': values['COURIER_ORGANIZATION_ID'], 'name': 'Release courier', 'humanApprovalRequired': True},
    ], 'principals': []}
    for role in ['merchant', 'courier']:
        provisioning['principals'].append({'id': str(uuid.uuid4()), 'organizationId': values[role.upper() + '_ORGANIZATION_ID'], 'name': 'Release ' + role, 'login': 'release-' + role, 'kind': 'integration', 'role': 'member', 'secret': values[role.upper() + '_INTEGRATION_TOKEN']})
    provisioning['principals'].append({'id': str(uuid.uuid4()), 'organizationId': values['MERCHANT_ORGANIZATION_ID'], 'name': 'Release approver', 'login': 'release-approver', 'kind': 'human', 'role': 'approver', 'secret': values['TEST_HUMAN_PASSWORD']})
    provision_file = directory / 'provision.json'
    provision_file.write_text(json.dumps(provisioning), encoding='utf-8')
    environment = directory / 'deploy.env'

    def save_environment():
        environment.write_text(''.join(name + '=' + value + '\n' for name, value in values.items()), encoding='utf-8')

    save_environment()
    compose = ['docker', 'compose', '--project-name', project, '--env-file', str(environment), '-f', 'infra/standalone/compose.yml']

    def command(arguments, name, expect_success=True):
        result = subprocess.run(arguments, cwd=ROOT, env={**os.environ, **values}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (directory / (name + '.log')).write_text(result.stdout, encoding='utf-8')
        if (result.returncode == 0) != expect_success:
            raise RuntimeError(f'{name} failed; inspect {directory / (name + ".log")}')
        return result.stdout

    def sql(database, statement, name):
        return command(compose + ['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], name).strip()

    def snapshot(label):
        result = {}
        for role in ['platform', 'merchant', 'courier']:
            database = 'porden_' + role
            tables = json.loads(sql(database, "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'", label + '-tables-' + role))
            data = {}
            for table in tables:
                identifier = '"' + table.replace('"', '""') + '"'
                data[table] = sql(database, "SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public." + identifier + ' t', label + '-' + role + '-' + table)
            owners = sql(database, "SELECT jsonb_agg(jsonb_build_array(tablename,tableowner) ORDER BY tablename) FROM pg_tables WHERE schemaname='public'", label + '-owners-' + role)
            sequences = sql(database, "SELECT coalesce(jsonb_agg(jsonb_build_array(sequencename,sequenceowner,last_value) ORDER BY sequencename),'[]') FROM pg_sequences WHERE schemaname='public'", label + '-sequences-' + role)
            result[role] = {'data': data, 'owners': owners, 'sequences': sequences}
        return result

    def checks(label):
        check_values = {key: value for key, value in values.items() if key.endswith(('_DATABASE_URL', '_INTEGRATION_TOKEN', '_ORGANIZATION_ID', '_DEMO_PASSWORD')) or key == 'TEST_HUMAN_PASSWORD'}
        check_values['SSL_CERT_FILE'] = '/certs/ca.pem'
        check_env = directory / 'check.env'
        check_env.write_text(''.join(name + '=' + value + '\n' for name, value in check_values.items()), encoding='utf-8')
        output = command(['docker', 'run', '--rm', '--network', project + '_default', '--env-file', str(check_env), '--mount', 'type=bind,source=' + str(ROOT / 'infra/standalone/tests/check.mjs') + ',target=/test/check.mjs,readonly', '--mount', 'type=bind,source=' + str(certificates) + ',target=/certs,readonly', '--entrypoint', 'bun', values['PORDEN_API_IMAGE'], '/test/check.mjs'], label)
        print(output, flush=True)

    def certificates_snapshot(label):
        return command(compose + ['exec', '-T', 'caddy', 'sh', '-c', 'find /data/caddy -type f -name "*.crt" -exec sha256sum {} +'], label).splitlines()

    try:
        command(compose + ['config', '--quiet'], 'compose-validation')
        command(compose + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'postgres', 'caddy'], 'database-and-caddy-startup')
        command(compose + ['cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', str(certificates / 'ca.pem')], 'copy-local-ca')
        values['PORDEN_EXTRA_CA_BASE64'] = base64.b64encode((certificates / 'ca.pem').read_bytes()).decode('ascii')
        save_environment()
        command(compose + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], 'api-startup')
        for service in ['platform', 'merchant', 'courier', 'merchant-web', 'courier-web', 'dashboard-web', 'postgres', 'caddy']:
            container = command(compose + ['ps', '-q', service], 'container-' + service).strip()
            bindings = json.loads(command(['docker', 'inspect', '--format', '{{json .HostConfig.PortBindings}}', container], 'ports-' + service)) or {}
            assert set(bindings) == ({'80/tcp', '443/tcp'} if service == 'caddy' else set()), service
            if service in ['platform', 'merchant', 'courier', 'merchant-web', 'courier-web', 'dashboard-web']:
                assert command(compose + ['exec', '-T', service, 'id', '-u'], 'uid-' + service).strip() == '1000'
                assert command(['docker', 'inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', container], 'readonly-' + service).strip() == 'true'
        print('PASS only Caddy publishes host ports; APIs and sites are non-root and read-only', flush=True)
        # Verify the actual published host ports with certificate and hostname checks enabled.
        context = ssl.create_default_context(cafile=str(certificates / 'ca.pem'))
        with socket.create_connection(('127.0.0.1', https_port)) as connection:
            with context.wrap_socket(connection, server_hostname=values['PLATFORM_DOMAIN']) as secure:
                secure.sendall(b'GET /health HTTP/1.1\r\nHost: api.porden.test\r\nConnection: close\r\n\r\n')
                response = http.client.HTTPResponse(secure); response.begin(); assert response.status == 200
        with socket.create_connection(('127.0.0.1', http_port)) as connection:
            connection.sendall(b'GET /health HTTP/1.1\r\nHost: api.porden.test\r\nConnection: close\r\n\r\n')
            response = http.client.HTTPResponse(connection); response.begin()
            assert response.status in [301, 308] and response.getheader('Location') == 'https://api.porden.test/health'
        print('PASS published HTTPS routing and automatic HTTP-to-HTTPS redirect', flush=True)
        command(compose + ['run', '--rm', '--no-deps', '--entrypoint', 'bun', '-v', str(provision_file) + ':/test/provision.json:ro', '-e', 'PORDEN_PROVISION_FILE=/test/provision.json', 'platform', 'apps/api/src/db/platform-provision.ts'], 'provision')
        checks('https-checks')
        # Browser flow through the real Caddy on the published port, across all three sites.
        browser_env = {**os.environ, 'PORDEN_DEPLOYED_HTTPS_PORT': str(https_port), 'PORDEN_DEPLOYED_PROOF': str(directory / 'browser'),
                       'MERCHANT_DEMO_PASSWORD': values['MERCHANT_DEMO_PASSWORD'], 'COURIER_DEMO_PASSWORD': values['COURIER_DEMO_PASSWORD'],
                       'TEST_HUMAN_PASSWORD': values['TEST_HUMAN_PASSWORD']}
        browser = subprocess.run(['bun', 'tests/test_deployed_browser.ts'], cwd=ROOT, env=browser_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (directory / 'browser.log').write_text(browser.stdout, encoding='utf-8')
        print(browser.stdout, flush=True)
        assert browser.returncode == 0, 'deployed-browser'
        for service in ['platform', 'merchant', 'courier']:
            path = 'platform-migrate.ts' if service == 'platform' else 'migrate.ts'
            command(compose + ['exec', '-T', service, 'bun', 'apps/api/src/db/' + path], 'migration-replay-' + service)
        before = snapshot('before-recreate')
        certs_before = sorted(certificates_snapshot('certificates-before'))
        command(compose + ['down'], 'remove-containers-preserve-volumes')
        command(compose + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], 'recreate-containers')
        assert snapshot('after-recreate') == before
        assert sorted(certificates_snapshot('certificates-after')) == certs_before
        print('PASS database rows, ownership, sequences and Caddy certificates survive container recreation', flush=True)
        # Quiesce writers and certificate renewal before making consistent backups.
        command(compose + ['stop', 'platform', 'merchant', 'courier', 'caddy'], 'stop-writers-for-backup')
        with (directory / 'caddy-data.tgz').open('wb') as archive:
            result = subprocess.run(compose + ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'caddy', 'czf', '-', '-C', '/data', '.'], cwd=ROOT, env={**os.environ, **values}, stdout=archive, stderr=subprocess.PIPE)
            assert result.returncode == 0, 'backup-caddy'
        # Binary-safe streams preserve pg_dump archives on Windows as well as Linux.
        for role in ['platform', 'merchant', 'courier']:
            with (directory / (role + '.dump')).open('wb') as archive:
                result = subprocess.run(compose + ['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', 'porden_' + role], cwd=ROOT, env={**os.environ, **values}, stdout=archive, stderr=subprocess.PIPE)
                assert result.returncode == 0, 'backup-' + role
        assert project.startswith('porden-release-') and len(project) == 27
        command(compose + ['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'caddy', '-c', 'find /data -mindepth 1 -delete'], 'clear-disposable-caddy-volume')
        with (directory / 'caddy-data.tgz').open('rb') as archive:
            result = subprocess.run(compose + ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'caddy', 'xzf', '-', '-C', '/data'], cwd=ROOT, env={**os.environ, **values}, stdin=archive, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert result.returncode == 0, 'restore-caddy'
        for role in ['platform', 'merchant', 'courier']:
            database = 'porden_' + role
            sql('postgres', 'DROP DATABASE ' + database, 'drop-disposable-' + role)
            sql('postgres', 'CREATE DATABASE ' + database + ' OWNER ' + database, 'recreate-disposable-' + role)
            sql('postgres', 'REVOKE CONNECT ON DATABASE ' + database + ' FROM PUBLIC; GRANT CONNECT ON DATABASE ' + database + ' TO ' + database, 'restore-connect-' + role)
            with (directory / (role + '.dump')).open('rb') as archive:
                result = subprocess.run(compose + ['exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '--exit-on-error', '--clean', '--if-exists', '-d', database], cwd=ROOT, env={**os.environ, **values}, stdin=archive, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                assert result.returncode == 0, 'restore-' + role
        assert snapshot('after-restore') == before
        command(compose + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'], 'restart-after-restore')
        assert sorted(certificates_snapshot('certificates-after-restore')) == certs_before
        checks('https-checks-after-restore')
        print('PASS database and Caddy backups restore exact data/ownership/sequences/certificates; protected writes still work', flush=True)
        command(compose + ['run', '--rm', '--no-deps', '-e', 'PORDEN_DATABASE_URL=postgres://release_invalid@postgres:5432/does_not_exist', 'platform'], 'invalid-migration-blocks-startup', expect_success=False)
        command(compose + ['stop', 'postgres'], 'stop-disposable-database')
        for service in ['platform', 'merchant', 'courier']:
            command(compose + ['exec', '-T', service, 'bun', 'infra/standalone/healthcheck.mjs'], 'unready-' + service, expect_success=False)
        print('PASS failed migrations block startup and database outage fails all readiness checks', flush=True)
        image_id = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', values['PORDEN_API_IMAGE']], 'image-id').strip()
        web_images = {app: command(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'porden-' + app + ':release-candidate'], 'image-id-' + app).strip() for app in ['merchant-web', 'courier-web', 'dashboard-web']}
        (directory / 'result.json').write_text(json.dumps({'passed': True, 'project': project, 'imageId': image_id, 'webImageIds': web_images, 'frontendsBehindCaddy': True, 'deployedBrowserFlow': True, 'rateLimitsThroughCaddy': True, 'singleComposeFile': 'infra/standalone/compose.yml', 'onlyCaddyPublishesPorts': True, 'databasePersistence': True, 'certificatePersistence': True, 'threeDatabaseBackupRestore': True, 'caddyBackupRestore': True, 'protectedWritesAfterRestore': True}), encoding='utf-8')
        print('Release evidence:', directory, flush=True)
    finally:
        # Only this generated disposable project may be removed; never use a production project here.
        assert project.startswith('porden-release-') and len(project) == 27
        subprocess.run(compose + ['down', '--volumes', '--remove-orphans'], cwd=ROOT, env={**os.environ, **values}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == '__main__':
    run_release_check()
