import { SQL } from 'bun';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migratePlatform } from '../apps/api/src/db/platform-migrate';
import { provisionPlatform } from '../apps/api/src/db/platform-provision';
import { reportError } from '../apps/api/src/security';

// shortcut: provisions the documented local Compose database only; use managed provisioning for deployment.
async function setup() {
  const configPath=resolve('apps/api/.env.platform'),directory=resolve('tmp/platform-demo');
  if(await Bun.file(configPath).exists())throw Error('Platform configuration already exists; reuse it instead of reprovisioning');
  const adminUrl=new URL(process.env.PORDEN_DEMO_ADMIN_DATABASE_URL||'postgres://porden_admin:local-admin-only@127.0.0.1:54329/postgres');
  if(!['127.0.0.1','localhost'].includes(adminUrl.hostname))throw Error('Demo setup requires a local PostgreSQL server');
  const admin=new SQL(adminUrl.href);
  let database:SQL|undefined;
  try {
    const existing=await admin`SELECT rolname FROM pg_roles WHERE rolname='porden_platform'`;
    if(existing.length)throw Error('porden_platform role already exists; configure its existing database explicitly');
    const dbPassword=randomBytes(32).toString('hex');
    await admin.unsafe(`CREATE ROLE porden_platform LOGIN PASSWORD '${dbPassword}'`);
    await admin.unsafe('CREATE DATABASE porden_platform OWNER porden_platform');
    await admin.unsafe('REVOKE CONNECT ON DATABASE porden_platform FROM PUBLIC; GRANT CONNECT ON DATABASE porden_platform TO porden_platform').simple();
    const databaseUrl=new URL(adminUrl);databaseUrl.username='porden_platform';databaseUrl.password=dbPassword;databaseUrl.pathname='/porden_platform';
    database=new SQL({url:databaseUrl.href,prepare:false});await migratePlatform(database);
    const orgA=crypto.randomUUID(),orgB=crypto.randomUUID();
    const organizations=[{id:orgA,name:'Company A',humanApprovalRequired:false},{id:orgB,name:'Company B',humanApprovalRequired:false}];
    const principals=[];
    for(const [organizationId,company] of [[orgA,'a'],[orgB,'b']]) {
      for(const role of ['member','approver'] as const)principals.push({id:crypto.randomUUID(),organizationId,name:`Company ${company.toUpperCase()} ${role}`,login:`${company}.${role}`,kind:'human' as const,role,secret:randomBytes(24).toString('base64url')});
      principals.push({id:crypto.randomUUID(),organizationId,name:`Company ${company.toUpperCase()} agent`,login:`${company}.agent`,kind:'integration' as const,role:'member' as const,secret:randomBytes(32).toString('base64url')});
    }
    await provisionPlatform(database,{organizations,principals});
    await mkdir(directory,{recursive:true});
    const keyPath=resolve(directory,'platform.pem');await writeFile(keyPath,generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
    await writeFile(resolve(directory,'accounts.json'),JSON.stringify({organizations,principals},null,2),{flag:'wx',mode:0o600});
    const env=[`PORDEN_DATABASE_URL=${databaseUrl.href}`,'PORDEN_PUBLIC_ORIGIN=http://localhost:4300','PORDEN_ALLOWED_ORIGINS=http://localhost:4300,http://localhost:4100,http://localhost:4200',`PORDEN_SESSION_SECRET=${randomBytes(48).toString('hex')}`,`PORDEN_SIGNING_KEY_PATH=${keyPath.replaceAll('\\','/')}`,'PORDEN_SIGNING_KEY_ID=porden-platform-v1','PORDEN_PORT=5300'];
    await writeFile(configPath,env.join('\n')+'\n',{flag:'wx',mode:0o600});
    console.log('Prepared local Porden platform. Configuration: apps/api/.env.platform. Local accounts: tmp/platform-demo/accounts.json. Start dev:platform, dev:dashboard, dev:merchant and dev:courier in separate terminals.');
  }finally{await database?.close();await admin.close();}
}
await setup().catch(error=>{reportError('local platform setup',error);process.exitCode=1;});
