# Benchmark judge report

Run 2026-11-05T16:06:40.159Z on the answers in `/tmp/claude-1000/-home-dl--prog-telegraph-pr-agent/15757316-a680-41b6-bb7c-782919267c88/scratchpad/bench-5`, judge: LLM miner 302 on Telegraph. 14 paid calls (0.1400 USDC); the other cases were answered from `bench/judge-cache.json`. Written by `bench/judge.ts`.

| SC-002 recall | By words | By words and the judge |
| --- | --- | --- |
| Cases within the model budget (the gate) | 222/368 (60.3%) | 245/368 (66.6%) |
| All positive cases | 235/427 (55.0%) | 269/427 (63.0%) |

Each pair the judge matched is listed below, for a reader to confirm.

| Case | By words | By the judge | Total |
| --- | --- | --- | --- |
| p01 (not in the gate) | 13/32 | +9 | 22/32 |
| p02 | 10/33 | +9 | 19/33 |
| p03 | 34/34 | +0 | 34/34 |
| p04 | 6/17 | +7 | 13/17 |
| p05 (not in the gate) | 0/27 | +2 | 2/27 |
| p06 | 19/24 | +1 | 20/24 |
| p07 | 0/8 | +0 | 0/8 |
| p08 | 10/22 | +0 | 10/22 |
| p09 | 11/11 | +0 | 11/11 |
| p10 | 12/19 | +2 | 14/19 |
| p11 | 3/6 | +0 | 3/6 |
| p12 | 7/7 | +0 | 7/7 |
| p13 | 1/33 | +0 | 1/33 |
| p14 | 0/7 | +1 | 1/7 |
| p15 | 1/1 | +0 | 1/1 |
| p16 | 15/15 | +0 | 15/15 |
| p17 | 1/1 | +0 | 1/1 |
| p18 | 5/5 | +0 | 5/5 |
| p19 | 7/12 | +1 | 8/12 |
| p20 | 1/2 | +0 | 1/2 |
| p21 | 21/34 | +0 | 21/34 |
| p22 | 0/0 | +0 | 0/0 |
| p23 | 25/25 | +0 | 25/25 |
| p24 | 0/2 | +0 | 0/2 |
| p25 | 0/1 | +0 | 0/1 |
| p26 | 16/16 | +0 | 16/16 |
| p27 | 0/0 | +0 | 0/0 |
| p28 | 0/0 | +0 | 0/0 |
| p29 | 0/1 | +0 | 0/1 |
| p30 | 17/32 | +2 | 19/32 |

## Pairs matched by the judge

### p01

- 4.0.0 Error customization: drops invalid_type_error and required_error ← drops `invalid_type_error` and `required_error`
- 4.0.0 Error customization: drops errorMap ← drops `errorMap`
- 4.0.0 ZodError: changes to .message ← changes to `.message`
- 4.0.0 ZodError: drops .formErrors ← drops `.formErrors`
- 4.0.0 ZodError: drops .errors ← drops `.errors`
- 4.0.0 z.string() updates: stricter .uuid() ← stricter `.uuid()`
- 4.0.0 z.string() updates: drops z.string().ip() ← drops `z.string().ip()`
- 4.0.0 z.object(): drops .nonstrict() ← drops `.nonstrict()`
- 4.0.0 z.object(): drops .deepPartial() ← drops `.deepPartial()`

### p02

- 5.0.0 app.del() was removed ← `app.del` - use `app.delete`
- 5.0.0 req.param(name) was removed ← `req.param()` -- use `req.params`, `req.body`, or `req.query` instead
- 5.0.0 res.send(status) with a number was removed ← `res.send(status)` signature - use `res.sendStatus(status)`
- 5.0.0 res.sendfile() was removed ← `res.sendfile` - use `res.sendFile` instead
- 5.0.0 Path route matching syntax changed (path-to-regexp 8) ← `path-to-regexp` dependency
- 5.0.0 express.static no longer serves dotfiles by default ← Remove `hidden` option; use `dotfiles` option instead
- 5.0.0 req.body is undefined when the body has not been parsed ← `req.body` is no longer always initialized to `{}`
- 5.0.0 req.params changed ← Named matching groups no longer available by position in `req.params`
- 5.0.0 res.vary throws without a field argument ← `res.vary()` (no arguments) -- provide a field name as an argument

### p04

- 6.0.0 resolve.conditions and ssr.resolve.conditions no longer get conditions added internally ← **resolve:** allow removing conditions ([#18395](https://github.com/vitejs/vite/issues/18395)) ([d002e7d](https://github.com/vitejs/vite/commit/d002e7d05a0f23110f9185b39222819bcdfffc16))
- 6.0.0 json.namedExports is respected with json.stringify, and json.stringify defaults to 'auto' ← **json:** add `json.stringify: 'auto'` and make that the default ([#18303](https://github.com/vitejs/vite/issues/18303)) ([b80daa7](https://github.com/vitejs/vite/commit/b80daa7c0970645dca569d572892648f66c6799c))
- 6.0.0 More HTML elements have their asset references processed ← **html:** support more asset sources ([#11138](https://github.com/vitejs/vite/issues/11138)) ([8a7af50](https://github.com/vitejs/vite/commit/8a7af50b5ddf72f21098406e9668bc609b323899))
- 6.0.0 postcss-load-config v6: TypeScript PostCSS configs need tsx or jiti ← **deps:** update postcss-load-config to v6 ([#15235](https://github.com/vitejs/vite/issues/15235)) ([3a27f62](https://github.com/vitejs/vite/commit/3a27f627df278f6c9778a55f44cb347665b65204))
- 6.0.0 The library-mode CSS file is named after the package instead of style.css ← **lib:** use package name for css output file name ([#18488](https://github.com/vitejs/vite/issues/18488)) ([61cbf6f](https://github.com/vitejs/vite/commit/61cbf6f2cfcd5afc91fe0a0ad56abfc36a32f1ab))
- 6.0.0 server.proxy bypass is called for WebSocket upgrades with res undefined ← proxy bypass with WebSocket ([#18070](https://github.com/vitejs/vite/issues/18070)) ([3c9836d](https://github.com/vitejs/vite/commit/3c9836d96f118ff5748916241bc3871a54247ad1))
- 6.0.0 dotenv-expand 12: variables must be declared before they are interpolated ← **deps:** update dependency dotenv-expand to v12 ([#18697](https://github.com/vitejs/vite/issues/18697)) ([0c658de](https://github.com/vitejs/vite/commit/0c658de41f4c1576c526a8c48a8ea0a019c6311c))

### p05

- 15.0.0 cookies, headers, draftMode, params and searchParams are asynchronous ← Async Request APIs (Breaking change)
- 15.0.0 runtime: 'experimental-edge' errors ← `runtime` configuration (Breaking change)

### p06

- 19.0.0 react-dom/test-utils was removed; act moved to react ← Remove `test-utils` ([\#28541](https://github.com/facebook/react/pull/28541) by @eps1lon)

### p10

- 8.0.0 null is valid for non-required string enums ← BREAKING CHANGE: allow null values for string enum #13620 #3044
- 8.0.0 save() applies minimize when it updates an existing document ← BREAKING CHANGE: apply minimize by default when updating document #13843

### p13

- the judge's reply was not the verdict object; nothing counted

### p14

- 7.0.0 All v6 future flags (v7_relativeSplatPath, v7_startTransition, v7_fetcherPersist, v7_normalizeFormMethod, v7_partialHydration, v7_skipActionStatusRevalidation) are now the default behaviour ← Remove remaining future flags ([#11820](https://github.com/remix-run/react-router/pull/11820))

### p19

- 3.0.0 The package is ESM only and cannot be required ← One major change is that it's now a ESM only package

### p30

- 8.0.0 no-useless-template-literals was removed ← User-Facing Changes
- 8.0.0 ESLint ^8.57.0 is the minimum ← [chore: bump minimum versions for v8](https://github.com/typescript-eslint/typescript-eslint/pull/8973)
