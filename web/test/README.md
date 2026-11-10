# Web UI browser tests

Phone Tasks entrance hit-test (Playwright). From this directory:

```bash
npm install
npm run test:phone-tasks
# optional screenshots: node capture-tasks-shots.mjs before|after
```

`phone-tasks-entrance.test.mjs` proves the collapsed Tasks toggle is in-viewport and
opens via a real coordinate mouse hit-test (`elementFromPoint` + `page.mouse`), not
`element.click()` / `dispatchEvent` alone.
