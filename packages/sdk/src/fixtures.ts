// Synthetic fixtures only. The private signing key was discarded.
export const signedReceiptFixture = {
  "token": "eyJhbGciOiJFUzI1NiIsInR5cCI6InBvcmRlbi1yZWNlaXB0K2p3dCIsImtpZCI6ImZpeHR1cmUtb25seSJ9.eyJpc3N1ZXIiOiJodHRwczovL2NvdXJpZXIuZXhhbXBsZSIsImF1ZGllbmNlIjoiaHR0cHM6Ly9tZXJjaGFudC5leGFtcGxlIiwidHJhbnNmZXJJZCI6IjEwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJlcXVlc3RJZCI6ImZpeHR1cmU6cmVxdWVzdDoxIiwiY2FzZUlkIjoiQ09VLUZJWFRVUkUiLCJyZWNlaXB0SWQiOiIyMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJjYXNlVHlwZSI6ImRlbGl2ZXJ5X2RhbWFnZSIsInBheWxvYWRTaGEyNTYiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiYXBwcm92ZWRGaWVsZHMiOlsib3JkZXJSZWZlcmVuY2UiLCJkYW1hZ2VEZXNjcmlwdGlvbiJdLCJzdGF0dXMiOiJhY2NlcHRlZCIsInJlY2VpdmVkQXQiOiIyMDI2LTExLTIzVDAwOjAwOjAwLjAwMFoifQ.qXAg_0hpsetjbm65BCIxPScbeHitTjx8tAxT5q_EB9beft03DkmQRImuLjn0IlgSrHkTUPtwDa5KPjhkakQHOg",
  "claims": {
    "issuer": "https://courier.example",
    "audience": "https://merchant.example",
    "transferId": "10000000-0000-4000-8000-000000000001",
    "requestId": "fixture:request:1",
    "caseId": "COU-FIXTURE",
    "receiptId": "20000000-0000-4000-8000-000000000001",
    "caseType": "delivery_damage",
    "payloadSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approvedFields": [
      "orderReference",
      "damageDescription"
    ],
    "status": "accepted",
    "receivedAt": "2026-11-23T00:00:00.000Z"
  },
  "jwks": {
    "keys": [
      {
        "kty": "EC",
        "x": "-yhGMGVFGpXlk6jjtD2PGXf7ddFiUxGfdr3vaJ_IbTw",
        "y": "jyN5rRC62bln2R9xSem6PFeUpHy54VVdHY7aGrpSFSE",
        "crv": "P-256",
        "kid": "fixture-only",
        "alg": "ES256",
        "use": "sig"
      }
    ]
  }
} as const;
export const invalidReceiptFixture = signedReceiptFixture.token.split('.').slice(0,2).join('.') + '.' + 'A'.repeat(86);
export const acceptedFixture = {status:'accepted',transferId:signedReceiptFixture.claims.transferId,receipt:{issuer:signedReceiptFixture.claims.issuer,receiptId:signedReceiptFixture.claims.receiptId,receiverCaseId:signedReceiptFixture.claims.caseId,requestId:signedReceiptFixture.claims.requestId,receivedAt:signedReceiptFixture.claims.receivedAt,verification:'valid'}} as const;
export const declinedFixture = {status:'cancelled',transferId:signedReceiptFixture.claims.transferId} as const;
export const unknownFixture = {status:'unknown',transferId:signedReceiptFixture.claims.transferId,reasonCode:'OUTCOME_UNKNOWN'} as const;
