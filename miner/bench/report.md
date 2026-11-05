# Benchmark report

Run 2026-11-05T16:48:03.865Z against https://telegraph-pr-miner-otcztx454-n30sk.vercel.app, processing version p5-bench6-miners_302-llm302-rules_and_model-s1.
38 cases answered, 2 skipped, 0 failed. Written by `bench/run.ts`.

## Success criteria

| Criterion | Result | Target | Status |
| --- | --- | --- | --- |
| SC-001 evidence: excerpt found in the cited source, at a version in range | 673/673 (100.0%) | ≥ 90% | pass |
| SC-002 recall of reviewed breaking changes, cases within the model budget | 247/368 (67.1%) | ≥ 80% | **FAIL** |
| SC-002 recall, all positive cases (for information) | 260/427 (60.9%) | — | — |
| SC-003 invented versions, dates or links | 0 | 0 | pass |
| SC-004 negative cases with the right outcome and no safe-upgrade claim | 8/8 | all | pass |
| SC-005 answers whose coverage names every release in range | 38/38 | all | pass |
| SC-006 repeats byte-identical | 38/38 | all | pass |
| SC-006 repeat latency p95 | 1056 ms | < 500 ms | **FAIL** |
| SC-006 first-time latency p50 / p95 (38 answers) | 4344 ms / 11198 ms | published; 2 s where the intent requires it | — |
| SC-008 security tests | see `test/unit/security.test.ts` | no private-network request, no package execution, no injection | — |
| SC-011 model calls and cost, first-time answers | 24 calls, 0.2400 USDC | reported against the payout per answer | — |
| SC-011 model cost, repeats | 0.0000 USDC | 0 | pass |
| SC-012 security conclusions match OSV and the US4 table | 38/38 | all | pass |

First calls that were already cached on this processing version: 0 (p50 n/a); they are left out of first-time latency and cost.

SC-001 is checked mechanically: the excerpt is in the source text fetched by this harness and the item's version is in range. Whether the excerpt supports the stated change and migration needs a reader.
SC-002 matches an expected entry to an answer item of the same version when the item's excerpt contains the expected quote, or shares at least half of its significant words, or states at least three quarters of the key's description of the change (words cut to five letters); unmatched entries are listed below for a reader to confirm.

## Cases

| Case | Outcome (expected) | First call | Repeat | Breaking found | Evidence | Problems |
| --- | --- | --- | --- | --- | --- | --- |
| p01 | found (found) | 6536 ms, miss, 1 model calls | 933 ms, hit | 13/32 | 36/36 | none |
| p02 | found (found) | 7689 ms, miss, 1 model calls | 660 ms, hit | 16/33 | 75/75 | none |
| p03 | found (found) | 4558 ms, miss, 1 model calls | 389 ms, hit | 34/34 | 54/54 | none |
| p04 | found (found) | 14633 ms, miss, 1 model calls | 587 ms, hit | 6/17 | 29/29 | none |
| p05 | found (found) | 11198 ms, miss, 0 model calls | 1525 ms, hit | 0/27 | 2/2 | none |
| p06 | found (found) | 3659 ms, miss, 0 model calls | 1056 ms, hit | 21/24 | 86/86 | none |
| p07 | found (found) | 2359 ms, miss, 0 model calls | 532 ms, hit | 0/8 | 0/0 | none |
| p08 | found (found) | 2752 ms, miss, 0 model calls | 832 ms, hit | 16/22 | 19/19 | none |
| p09 | found (found) | 5747 ms, miss, 1 model calls | 421 ms, hit | 11/11 | 16/16 | none |
| p10 | found (found) | 7411 ms, miss, 1 model calls | 441 ms, hit | 12/19 | 20/20 | none |
| p11 | found (found) | 5874 ms, miss, 1 model calls | 353 ms, hit | 3/6 | 41/41 | none |
| p12 | found (found) | 5226 ms, miss, 1 model calls | 331 ms, hit | 7/7 | 20/20 | none |
| p13 | found (found) | 5068 ms, miss, 1 model calls | 453 ms, hit | 4/33 | 59/59 | none |
| p14 | found (found) | 6377 ms, miss, 1 model calls | 577 ms, hit | 0/7 | 39/39 | none |
| p15 | found (found) | 5155 ms, miss, 1 model calls | 409 ms, hit | 1/1 | 1/1 | none |
| p16 | found (found) | 5536 ms, miss, 1 model calls | 391 ms, hit | 15/15 | 18/18 | none |
| p17 | found (found) | 7773 ms, miss, 1 model calls | 357 ms, hit | 1/1 | 1/1 | none |
| p18 | found (found) | 4344 ms, miss, 1 model calls | 339 ms, hit | 5/5 | 19/19 | none |
| p19 | found (found) | 3436 ms, miss, 1 model calls | 370 ms, hit | 7/12 | 8/8 | none |
| p20 | found (found) | 4009 ms, miss, 1 model calls | 343 ms, hit | 1/2 | 1/1 | none |
| p21 | found (found) | 7514 ms, miss, 0 model calls | 701 ms, hit | 29/34 | 33/33 | none |
| p22 | found (found) | 3122 ms, miss, 1 model calls | 360 ms, hit | 0/0 | 1/1 | none |
| p23 | found (found) | 9566 ms, miss, 1 model calls | 433 ms, hit | 25/25 | 32/32 | none |
| p24 | found (found) | 6769 ms, miss, 1 model calls | 417 ms, hit | 0/2 | 1/1 | none |
| p25 | found (found) | 4294 ms, miss, 1 model calls | 334 ms, hit | 0/1 | 4/4 | none |
| p26 | found (found) | 6641 ms, miss, 1 model calls | 424 ms, hit | 16/16 | 33/33 | none |
| p27 | not_found (found) | 1591 ms, miss, 0 model calls | 555 ms, hit | 0/0 | 0/0 | wrong outcome |
| p28 | found (found) | 2681 ms, miss, 1 model calls | 345 ms, hit | 0/0 | 1/1 | none |
| p29 | found (found) | 3668 ms, miss, 1 model calls | 335 ms, hit | 0/1 | 0/0 | safe-upgrade claim |
| p30 | found (found) | 5587 ms, miss, 1 model calls | 898 ms, hit | 17/32 | 24/24 | none |
| n01 | not_found (not_found) | 343 ms, miss, 0 model calls | 320 ms, miss | — | 0/0 | none |
| n02 | not_found (not_found) | 326 ms, miss, 0 model calls | 308 ms, miss | — | 0/0 | none |
| n03 | out_of_scope (out_of_scope) | 450 ms, miss, 0 model calls | 420 ms, miss | — | 0/0 | none |
| n04 | out_of_scope (out_of_scope) | 290 ms, miss, 0 model calls | 325 ms, miss | — | 0/0 | none |
| n05 | needs_clarification (needs_clarification) | 298 ms, miss, 0 model calls | 294 ms, miss | — | 0/0 | none |
| n06 | not_found (not_found) | 1938 ms, miss, 0 model calls | 750 ms, hit | — | 0/0 | none |
| n07 | not_found (found or not_found) | 1688 ms, miss, 0 model calls | 567 ms, hit | — | 0/0 | none |
| n08 | — (temporarily_unavailable) | skipped: needs a local run with a simulated outage | | | | |
| n09 | — (found) | skipped: needs a local run with a simulated outage | | | | |
| n10 | needs_clarification (needs_clarification) | 305 ms, miss, 0 model calls | 326 ms, miss | — | 0/0 | none |

## Details

### p01

- not found: 4.0.0 Error customization: drops invalid_type_error and required_error
- not found: 4.0.0 Error customization: drops errorMap
- not found: 4.0.0 ZodError: changes to .message
- not found: 4.0.0 ZodError: updates issue formats
- not found: 4.0.0 ZodError: drops .formErrors
- not found: 4.0.0 ZodError: drops .errors
- not found: 4.0.0 z.number(): no infinite values
- not found: 4.0.0 z.string() updates: stricter .uuid()
- not found: 4.0.0 z.string() updates: no padding in .base64url()
- not found: 4.0.0 z.string() updates: drops z.string().ip()
- not found: 4.0.0 z.string() updates: updates z.string().ipv6()
- not found: 4.0.0 z.object(): defaults applied within optional fields
- not found: 4.0.0 z.object(): drops .nonstrict()
- not found: 4.0.0 z.object(): drops .deepPartial()
- not found: 4.0.0 .refine(): ignores type predicates
- not found: 4.0.0 z.coerce input type is unknown
- not found: 4.0.0 .default() short-circuits on undefined and applies to the output type
- not found: 4.0.0 z.function() is no longer a Zod schema
- not found: 4.0.0 z.record() with an enum key schema is exhaustive

### p02

- not found: 5.0.0 app.del() was removed
- not found: 5.0.0 Pluralized method names: req.acceptsCharset, acceptsEncoding, acceptsLanguage were removed
- not found: 5.0.0 res.send(status) with a number was removed
- not found: 5.0.0 res.sendfile() was removed
- not found: 5.0.0 router.param(fn) was removed
- not found: 5.0.0 MIME types changed
- not found: 5.0.0 Path route matching syntax changed (path-to-regexp 8)
- not found: 5.0.0 express.urlencoded defaults extended to false
- not found: 5.0.0 express.static no longer serves dotfiles by default
- not found: 5.0.0 app.listen behaviour changed
- not found: 5.0.0 app.router was removed
- not found: 5.0.0 req.body is undefined when the body has not been parsed
- not found: 5.0.0 req.host keeps the port
- not found: 5.0.0 req.params changed
- not found: 5.0.0 req.query is a getter and its parser changed
- not found: 5.0.0 res.clearCookie ignores maxAge and expires
- not found: 5.0.0 res.vary throws without a field argument

### p04

- not found: 6.0.0 resolve.conditions and ssr.resolve.conditions no longer get conditions added internally
- not found: 6.0.0 json.namedExports is respected with json.stringify, and json.stringify defaults to 'auto'
- not found: 6.0.0 More HTML elements have their asset references processed
- not found: 6.0.0 postcss-load-config v6: TypeScript PostCSS configs need tsx or jiti
- not found: 6.0.0 The library-mode CSS file is named after the package instead of style.css
- not found: 6.0.0 server.proxy bypass is called for WebSocket upgrades with res undefined
- not found: 6.0.0 commonjsOptions.strictRequires defaults to true
- not found: 6.0.0 Range and incremental braces are no longer supported in globs
- not found: 6.0.0 resolve.mainFields is not used for non-externalized SSR dependencies
- not found: 6.0.0 dotenv-expand 12: variables must be declared before they are interpolated
- not found: 6.0.0 Updating an SSR-only module no longer reloads the client page

### p05

- not found: 15.0.0 React 19 is the minimum for the App Router
- not found: 15.0.0 useFormState is replaced by useActionState
- not found: 15.0.0 cookies, headers, draftMode, params and searchParams are asynchronous
- not found: 15.0.0 runtime: 'experimental-edge' errors
- not found: 15.0.0 fetch requests are not cached by default
- not found: 15.0.0 GET route handlers are not cached by default
- not found: 15.0.0 Page segments are not reused from the client cache on navigation
- not found: 15.0.0 @next/font was removed
- not found: 15.0.0 experimental.bundlePagesExternals was renamed to bundlePagesRouterDependencies
- not found: 15.0.0 experimental.serverComponentsExternalPackages was renamed to serverExternalPackages
- not found: 15.0.0 Speed Insights auto instrumentation was removed
- not found: 15.0.0 NextRequest geo and ip were removed
- not found: 15.0.0 next/image no longer uses squoosh; sharp is an optional dependency
- not found: 15.0.0 The deprecated analyticsId config was removed
- not found: 15.0.0 next/image serves images with Content-Disposition: attachment by default
- not found: 15.0.0 next/image errors when src has leading or trailing spaces
- not found: 15.0.0 Middleware applies the react-server condition, limiting React API imports
- not found: 15.0.0 next/font no longer hashes font-family names
- not found: 15.0.0 force-dynamic sets a no-store default for the fetch cache
- not found: 15.0.0 swcMinify, missingSuspenseWithCSRBailout and outputFileTracing behaviour is on by default and their options were removed
- not found: 15.0.0 Dynamic sitemap routes lose the .xml extension
- not found: 15.0.0 revalidateTag and revalidatePath throw when called during render
- not found: 15.0.0 instrumentation.js and middleware.js use the vendored React packages
- not found: 15.0.0 Node.js 18.18.0 is the minimum
- not found: 15.0.0 next/dynamic drops the suspense prop and no longer inserts an empty Suspense boundary in the App Router
- not found: 15.0.0 The worker module condition is not applied on the Edge Runtime
- not found: 15.0.0 ssr: false with next/dynamic is not allowed in Server Components

### p06

- not found: 19.0.0 StrictMode reuses useMemo/useCallback results in the second render and double-invokes ref callbacks on mount
- not found: 19.0.0 react-dom throws when the react and react-dom versions differ
- not found: 19.0.0 Empty src and href attributes are not rendered

### p07

- not found: 5.6.2 lib.d.ts types changed
- not found: 5.6.2 .tsbuildinfo is always written
- not found: 5.6.2 File extensions and package.json inside node_modules are respected
- not found: 5.6.2 override checks on computed properties are correct (new errors)
- not found: 5.6.2 Truthy and nullish checks that always evaluate the same way are errors
- not found: 5.6.2 --build continues past intermediate errors in dependencies
- not found: 5.6.2 .mts files never emit CommonJS and .cts files never emit ESM
- not found: 5.6.2 --strict enables --strictBuiltinIteratorReturn, so built-in iterators return undefined instead of any

### p08

- not found: 3.0.0 --parser=css no longer parses SCSS or Less; those files need the scss or less parser
- not found: 3.0.0 Markdown no longer gets spaces inserted between Chinese or Japanese and Western characters
- not found: 3.0.0 A printer's embed method has a new, incompatible signature
- not found: 3.0.0 --loglevel was renamed to --log-level
- not found: 3.0.0 Unknown code is no longer formatted with the babel parser
- not found: 3.0.0 Globs are not expanded through symbolic links

### p10

- not found: 8.0.0 null is valid for non-required string enums
- not found: 8.0.0 save() applies minimize when it updates an existing document
- not found: 8.0.0 findOneAndUpdate() with orFail() and upsert behaves differently
- not found: 8.0.0 TypeScript: model constructor properties are all optional
- not found: 8.0.0 The ObjectId constructor no longer accepts 12-character strings
- not found: 8.0.0 Deprecated ssl* connection options were removed in favour of tls* options
- not found: 8.0.0 findByIdAndRemove() was removed

### p11

- not found: 1.0.0 AxiosError.config is optional in the types
- not found: 1.0.0 Interceptors must return a value
- not found: 1.0.0 false, 0 and an empty string are not sent as a request body

### p13

- not found: 4.0.0 Targets Safari 16.4, Chrome 111 and Firefox 128; older browsers are not supported
- not found: 4.0.0 Several utilities were renamed
- not found: 4.0.0 The shadow, radius and blur scales were renamed, so -sm utilities look different
- not found: 4.0.0 outline sets a 1px width and outline-<number> defaults to solid
- not found: 4.0.0 ring is 1px instead of 3px and uses currentColor instead of blue-500
- not found: 4.0.0 space-x/space-y use a different selector
- not found: 4.0.0 divide-x/divide-y use a different selector
- not found: 4.0.0 A variant on part of a gradient no longer resets the whole gradient
- not found: 4.0.0 The container configuration options were removed
- not found: 4.0.0 border and divide default to currentColor instead of gray-200
- not found: 4.0.0 Placeholder text uses the current text colour at 50% opacity
- not found: 4.0.0 Preflight resets dialog margins
- not found: 4.0.0 The hidden attribute takes priority over display classes
- not found: 4.0.0 A prefix is written like a variant at the start of the class
- not found: 4.0.0 The important modifier ! goes at the end of the class name
- not found: 4.0.0 Custom utilities need @utility instead of @layer utilities/components
- not found: 4.0.0 Stacked variants apply left to right
- not found: 4.0.0 CSS variables in arbitrary values use parentheses instead of square brackets
- not found: 4.0.0 Commas in grid and object-position arbitrary values are no longer turned into spaces
- not found: 4.0.0 hover only applies on devices that support hover
- not found: 4.0.0 transition and transition-colors include outline-color
- not found: 4.0.0 rotate, scale and translate use the individual CSS properties; transform-none no longer resets them
- not found: 4.0.0 corePlugins is no longer supported
- not found: 4.0.0 A JavaScript config file is no longer detected automatically
- not found: 4.0.0 resolveConfig is no longer exported
- not found: 4.0.0 Separately bundled stylesheets (CSS modules, Vue/Svelte style blocks) do not see theme variables and custom utilities
- not found: 4.0.0 The PostCSS plugin moved to @tailwindcss/postcss
- not found: 4.0.0 The CLI moved to @tailwindcss/cli
- not found: 4.0.0 theme() takes CSS variable names instead of dot notation

### p14

- not found: 7.0.0 react-router-dom and the @remix-run router packages were collapsed into react-router
- not found: 7.0.0 react-router-dom-v5-compat and react-router-native are no longer published
- not found: 7.0.0 json, defer and the unstable upload handler APIs were removed
- not found: 7.0.0 Node.js 20 is required and installGlobals was removed
- not found: 7.0.0 React 18 is the minimum React version
- not found: 7.0.0 All v6 future flags (v7_relativeSplatPath, v7_startTransition, v7_fetcherPersist, v7_normalizeFormMethod, v7_partialHydration, v7_skipActionStatusRevalidation) are now the default behaviour
- not found: 7.0.0 useNavigate(), useSubmit(), fetcher.load/submit and revalidate() now return promises instead of undefined

### p19

- not found: 3.0.0 Node.js 12.20 or newer is required
- not found: 3.0.0 The package is ESM only and cannot be required
- not found: 3.0.0 res.json() throws SyntaxError instead of FetchError on invalid JSON
- not found: 3.0.0 Body stream errors are forwarded through a pipeline, so an 'on error' listener can fire twice
- not found: 3.0.0 The default User-Agent changed

### p20

- not found: 16.0.0 @types/react-dom must be installed for type checking

### p21

- not found: 5.0.0 getQueryState accepts the queryKey only
- not found: 5.0.0 Browser support changed
- not found: 5.0.0 The dehydrate API changed
- not found: 5.0.0 The experimental suspense flag on query hooks was removed
- not found: 5.0.0 HydrationBoundary no longer hydrates mutations

### p24

- not found: 10.0.0 Node.js 12 is no longer supported; 16 or newer is required
- not found: 10.0.0 A middleware runs once for a matching route

### p25

- not found: 0.21.0 Decorators in JavaScript, and in TypeScript without experimentalDecorators, are transformed as standard JavaScript decorators

### p29

- not found: 17.0.0 config() now logs an informational line (file and key count) by default

### p30

- not found: 8.0.0 no-empty-object-type was split out of ban-types and no-empty-interface
- not found: 8.0.0 The shared configs changed for v8
- not found: 8.0.0 ban-types was replaced by no-restricted-types, no-unsafe-function-type and no-wrapper-object-types
- not found: 8.0.0 no-useless-template-literals was removed
- not found: 8.0.0 no-floating-promises: checkThenables is off by default
- not found: 8.0.0 RuleTester uses flat config
- not found: 8.0.0 projectService is also removed in withoutProjectParserOptions
- not found: 8.0.0 ESLint ^8.57.0 is the minimum
- not found: 8.0.0 Node.js 20.0-20.8 and 21.0 are no longer supported
- not found: 8.0.0 TypeScript 4.8.4 is the minimum
- not found: 8.0.0 EXPERIMENTAL_useProjectService was renamed to projectService
- not found: 8.0.0 Rule meta.docs only allows description and url unless RuleCreator is given a docs type
- not found: 8.0.0 RuleTester applies multi-pass fixes, so such test cases fail until their output lists each pass
- not found: 8.0.0 RuleTester defaults ecmaVersion to latest
- not found: 8.0.0 getTypeArguments was removed from type-utils

