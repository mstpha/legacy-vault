# Backup backend test reports

The simple plain-English Jest reporter is available without changing the
existing default Jest output.

Run only the database-free unit tests with the report:

```powershell
npm run test:report
```

The existing end-to-end tests use a real database and can create and delete
test data. Run them only after `.env.test` points to a separate disposable
database, migrations have been applied, and you have confirmed the target:

```powershell
npm run test:report:e2e
```

The existing `npm test` command still runs both Jest projects with the standard
Jest reporter. Keep it pointed at a disposable test database before running it.
