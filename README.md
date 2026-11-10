# Let Them In

Who does your shop lock out? Five AI shoppers with different access needs try to buy something in a real shop, in a real browser. Each one gets only what their need allows. Joel can only use the keyboard. Maya is blind and only gets what a screen reader reads out. Ines has the page zoomed to 200 percent. Kofi is on a cheap phone with a weak connection. Tom has no access needs and is the baseline.

The records show where each one got stuck. The AI reads those records and the shop's source, writes a patch, the shop is rebuilt from it and the same five go again. The report puts both rounds side by side, with every step, every screenshot and the patch.

The shop is the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) at release 3.1.0, an open source web shop that sells telescopes. Its frontend is not changed before the first round.

## What the shoppers can do

| Shopper | Need | Perceives | Can do |
|---|---|---|---|
| Tom | none | screenshot with numbered boxes on things that look clickable | click, type, select, scroll |
| Joel | keyboard only | plain screenshot, so he has to spot the focus outline himself | Tab, Shift+Tab, Enter, Space, arrows, Escape, type |
| Maya | blind, screen reader | only the accessibility tree, no image | move to an item and activate it, type, select, keys |
| Ines | low vision, 200 percent zoom | screenshot of a 640x400 window drawn at 2x | click, type, select, scroll |
| Kofi | cheap phone, slow network | phone screenshot, network at about 500 kbit/s with 400 ms latency, CPU slowed 4x | tap, type, select, scroll, wait |

Every shopper has the same job: buy one product, change the email at checkout to their own and place the order. A visit counts as bought only when the shop's own order confirmation page loads with an order id. A shopper who says they are done before that is told the shop has not confirmed anything.

There is also a check with no AI at all: axe-core runs on the home, product and cart pages, and a scripted Tab walk records whether each stop on the product page shows where the focus is.

## Setup

You need Node 22 or newer, Docker with Compose v2 and about 6 GB of free memory for the shop.

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
```

## See the saved results, no API key, no cost

The `runs/` folder has the recorded rounds: every step as JSON, a screenshot per step, the scan, the patch and the build result.

```sh
npm run report -- runs/<before-round> runs/<after-round>
```

Open `report/index.html` in a browser. The report in the repo is already built from the recorded rounds listed at the bottom of this file.

## Run the free check on the real shop

```sh
npm run shop        # clones the shop at 3.1.0 into shop/src, builds its frontend and starts it on :8090
npm run scan        # axe-core and the Tab walk, results in runs/scratch/scan.json
```

`bash shop/shop.sh down` stops the shop. The shop's own load generator is stopped after start, and its collector is swapped for a small config that drops telemetry, since none of it is needed here.

## Run new shoppers (paid model calls)

Model calls need an OpenAI key in `OPENAI_API_KEY` or a file named by `OPENAI_API_KEY_FILE`, and a spend limit in `LTI_BUDGET_USD`. Without the limit no call is made. Every call is logged with its tokens and cost in `spend/openai.jsonl` and a call is refused once the logged total reaches the limit.

```sh
export OPENAI_API_KEY_FILE=/path/to/key LTI_BUDGET_USD=5
npm run round -- before     # all five shoppers on the unchanged shop
npm run fix                 # the AI writes a patch from the latest before round, the shop frontend is rebuilt with it
npm run round -- after      # the same five on the patched shop
npm run report
npm run spend               # cost per round and in total
bash shop/shop.sh reset     # back to the released frontend
```

`npx tsx src/cli.ts demo` does the whole loop in one go and resets the shop at the end. `--only joel,maya` runs some of the shoppers.

The shoppers use `gpt-5.4-mini` and the fix uses `gpt-5.5`. `LTI_SHOPPER_MODEL` and `LTI_FIX_MODEL` change them, and the price table in `src/ai.ts` has to know the model. A round of five costs around 0.10 to 0.30 USD. Results change between rounds, since the shoppers are a model.

## How the fix works

The AI gets the last steps and the reason of every shopper who did not buy, the scan findings and the shop's frontend source (components, pages and styles). It answers with exact find and replace edits, each with the barrier it removes and who it should help. An edit whose text does not appear exactly once is refused. The edits become `fix.diff` in the round folder, the shop frontend image is rebuilt from it (Next.js build with its type check and lint), and if the build fails the error goes back to the AI once.

## Layout

```
src/shoppers.ts   the five shoppers
src/browser.ts    Chromium set up per access need
src/perceive.ts   what each shopper gets to see or hear at a step
src/walk.ts       one visit, step by step
src/scan.ts       axe-core and the Tab walk, no AI
src/round.ts      a round of all shoppers
src/fix.ts        the patch and the rebuild
src/report.ts     the report page
shop/             scripts to run the OpenTelemetry Demo
runs/             recorded rounds
spend/            every model call with its cost
```

MIT licence. The OpenTelemetry Demo is Apache 2.0 and is cloned at run time, not copied into this repo.
