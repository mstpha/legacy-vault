# Tests et performances des applications mobiles

This suite covers the mobile app's critical client-side behavior without requiring
an emulator or a live backend:

- API authorization, one-time token refresh, idempotency, and primary/backup failover
- AES capsule encryption/decryption, chunk progress, and fresh per-blob IVs
- sealed device-key passphrase sharing, Unicode handling, and tamper rejection
- secure-store token access and biometric confirmation before protected key creation

Run the unit and security checks:

```powershell
npm test
npm run test:security
```

Run the separately budgeted 512 KiB encryption/decryption benchmark:

```powershell
npm run test:performance
```

Set `MOBILE_CRYPTO_MAX_MS` to change the per-operation latency ceiling (default:
15,000 ms). The benchmark mocks only secure random byte generation and measures
the JavaScript cryptography path in Node. For release acceptance, run equivalent
profiling on real iOS and Android devices; emulator and Node measurements are not
representative of every device.
