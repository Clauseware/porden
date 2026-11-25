const mock = Boolean(process.env.ORGANIZATION_ROLE);
const port = mock ? process.env.PORT : process.env.PORDEN_PORT;
if (!port) throw Error('Health check requires the configured service port');
const response = await fetch(`http://127.0.0.1:${port}/ready`, {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw Error(`API readiness returned HTTP ${response.status}`);
