"""HTTP and persistence tests, runnable without a browser or external dependencies."""
import base64
import http.client
import json
import os
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

ROOT=Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def read_db(path, sql, params=()):
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def stop_server(proc):
    if os.name == 'nt':
        proc.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


@pytest.fixture(scope='module')
def app():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        db = str(tmp_path / 'data.sqlite')
        merchant_port = free_port()
        courier_port = free_port()
        while courier_port == merchant_port:
            courier_port = free_port()
        popen_kwargs = dict(
            cwd=ROOT,
            env={
                **os.environ,
                'HANDOFF_DB': db,
                'HANDOFF_SIGNING_KEY': str(tmp_path / 'courier-signing-key.pem'),
                'HANDOFF_MERCHANT_PORT': str(merchant_port),
                'HANDOFF_COURIER_PORT': str(courier_port),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        if os.name == 'nt':
            popen_kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(['node', 'server.mjs'], **popen_kwargs)

        try:
            for _ in range(90):
                try:
                    code, _, _ = req(courier_port, 'GET', '/agent-manifest.json')
                    if code == 200:
                        break
                except Exception:
                    time.sleep(0.1)
            else:
                raise RuntimeError('Server startup failed')

            yield {
                'db': db,
                'merchant_port': merchant_port,
                'courier_port': courier_port,
            }

        finally:
            stop_server(proc)


def req(port,method,path,obj=None,headers=None):
    conn=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
    hdr=dict(headers or {})
    body=None if obj is None else json.dumps(obj).encode()
    if body is not None: hdr['Content-Type']='application/json'
    conn.request(method,path,body=body,headers=hdr)
    response=conn.getresponse();data=response.read();out=(response.status,dict(response.getheaders()),data)
    conn.close();return out

def session(courier_port):
    code,hdr,_=req(courier_port,'GET','/bridge.html');assert code==200
    cookie=hdr['Set-Cookie'].split(';')[0]
    code,_,data=req(courier_port,'GET','/api/session',headers={'Cookie':cookie})
    assert code==200
    return cookie,json.loads(data)['csrf']

def post(payload,cookie,csrf,courier_port,origin=None):
    if origin is None:
        origin=f'http://localhost:{courier_port}'
    status,_,data=req(courier_port,'POST','/api/cases',payload,headers={'Origin':origin,'Cookie':cookie,'X-CSRF-Token':csrf})
    return status,json.loads(data)

def valid_payload(transfer_id='handoff_api_test',address=False):
    payload={'transferId':transfer_id,'orderReference':'DEMO-1042','damageDescription':'The shipping box arrived with visible damage.'}
    if address:payload['deliveryAddress']='12 Example Street, Tangerang'
    return payload

def decode_b64(s):return base64.urlsafe_b64decode(s+'='*((-len(s))%4))

def verify_receipt(token,jwk):
    header,payload,signature=token.split('.')
    sig=decode_b64(signature)
    n=len(sig)//2
    der=encode_dss_signature(int.from_bytes(sig[:n]),int.from_bytes(sig[n:]))
    pub=ec.EllipticCurvePublicNumbers(int.from_bytes(decode_b64(jwk['x']),'big'),int.from_bytes(decode_b64(jwk['y']),'big'),ec.SECP256R1()).public_key()
    pub.verify(der,(header+'.'+payload).encode(),ec.ECDSA(hashes.SHA256()))
    return json.loads(decode_b64(payload))

def test_discovery_and_cors(app):
    courier_port=app['courier_port'];merchant_port=app['merchant_port']
    status,head,data=req(courier_port,'GET','/agent-manifest.json',headers={'Origin':f'http://localhost:{merchant_port}'})
    assert status==200 and head['Access-Control-Allow-Origin']=='*'
    assert json.loads(data)['front_man']=='courier_front'

def test_authorization_and_csrf(app):
    courier_port=app['courier_port'];merchant_port=app['merchant_port']
    cookie,csrf=session(courier_port)
    payload=valid_payload('handoff_rejected_origin')
    assert post(payload,cookie,csrf,courier_port,origin=f'http://localhost:{merchant_port}')[0]==403
    assert post(payload,cookie,'incorrect',courier_port)[0]==403
    assert post({'transferId':'bad'},cookie,csrf,courier_port)[0]==400
    assert req(courier_port,'GET','/api/session')[0]==401

def test_case_persistence_and_signed_receipt(app):
    courier_port=app['courier_port']
    cookie,csrf=session(courier_port)
    payload=valid_payload('handoff_signed_test')
    status,result=post(payload,cookie,csrf,courier_port)
    assert status==201 and not result['idempotent']
    caseId=result['caseId'];receiptId=result['receiptId']
    record=read_db(app['db'], 'SELECT payload FROM cases WHERE id=?', (caseId,))
    assert record is not None
    stored=json.loads(record[0]);assert stored==payload and 'deliveryAddress' not in stored
    _,_,jwks=req(courier_port,'GET','/.well-known/jwks.json')
    signed=verify_receipt(result['receipt'],json.loads(jwks)['keys'][0])
    assert signed['caseId']==caseId and signed['receiptId']==receiptId
    assert signed['approvedFields']==['orderReference','damageDescription']
    status,_,data=req(courier_port,'GET','/api/receipts/'+receiptId,headers={'Cookie':cookie})
    assert status==200 and json.loads(data)['case']['id']==caseId
    assert req(courier_port,'GET','/api/receipts/'+receiptId)[0]==401

def test_address_optional_and_replay(app):
    courier_port=app['courier_port']
    cookie,csrf=session(courier_port)
    payload=valid_payload('handoff_address_test',address=True)
    first,one=post(payload,cookie,csrf,courier_port);second,two=post(payload,cookie,csrf,courier_port)
    assert first==201 and second==200
    assert one['caseId']==two['caseId'] and two['idempotent']
    rec=read_db(app['db'], 'SELECT payload FROM cases WHERE id=?', (one['caseId'],))[0]
    n=read_db(app['db'], 'SELECT COUNT(*) FROM cases WHERE transfer_id=?', (payload['transferId'],))[0]
    assert json.loads(rec)['deliveryAddress']=='12 Example Street, Tangerang'
    assert n==1
    status,result=post({**payload,'damageDescription':'A changed payload should conflict.'},cookie,csrf,courier_port)
    assert status==409 and 'different payload' in result['error']

def test_unknown_order_rejected(app):
    courier_port=app['courier_port']
    cookie,csrf=session(courier_port)
    status,result=post({**valid_payload('handoff_wrong_order'),'orderReference':'SOMEONE-ELSE-ORDER'},cookie,csrf,courier_port)
    assert status==400

def test_signature_tampering_rejected(app):
    courier_port=app['courier_port']
    cookie,csrf=session(courier_port)
    status,result=post(valid_payload('handoff_tamper_test'),cookie,csrf,courier_port)
    assert status==201
    _,_,jwks=req(courier_port,'GET','/.well-known/jwks.json')
    jwk=json.loads(jwks)['keys'][0]
    a,b,c=result['receipt'].split('.')
    modified=json.loads(decode_b64(b));modified['status']='approved_for_refund'
    mod_b=base64.urlsafe_b64encode(json.dumps(modified).encode()).decode().rstrip('=')
    with pytest.raises(Exception):verify_receipt('.'.join([a,mod_b,c]),jwk)