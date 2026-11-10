# Series A, shoppers on gpt-5.4-mini

The first full series, Nov 10 2026 (UTC). Same shop, same five shoppers and the same rules as series B, with the shoppers on `gpt-5.4-mini` and the fixes on `gpt-5.5`. These round records were written before `round.json` had a `shopperModel` field.

| Round | Shop | Bought |
|---|---|---|
| `20261110-0314-before` | released 3.1.0 frontend | 3 of 5 (Joel and Kofi out) |
| `20261110-0321-after` | after fix 1 (`20261110-0314-before/fix.diff`) | 4 of 5 (Joel out) |
| `20261110-0327-after2` | after fix 2 (`20261110-0321-after/fix.diff` on top of fix 1) | 4 of 5 (Joel out) |
| `20261110-0330-after2-joel60` | after fix 2, Joel only, 60 steps instead of 30 | 0 of 1 |
| `20261110-0335-after2-joel-strong` | after fix 2, Joel only, shopper on `gpt-5.5` | 1 of 1, 17 steps |

What it found:

- Kofi, on the slow phone, placed his order on the released shop but his phone showed "Your shopping cart is empty!" and no confirmation, so he went back to shopping. `20261110-0314-before/email-service.log` has the confirmation for his order. Fix 1 kept the cart on screen while the order goes through, and he got his confirmation in both later rounds.
- Fix 1 put Place Order first in the code but kept it on the right on screen, so Tab went right to left across the two buttons and Joel tabbed past Place Order. Fix 2 put the buttons back in screen order.
- Joel never got in on `gpt-5.4-mini`, even with 60 steps on the fixed shop. It guessed where the focus was instead of following the outline. On `gpt-5.5` he bought on the same fixed shop in 17 steps, so series B uses `gpt-5.5` for the shoppers.

`20261110-0314-before/shop.diff` is a copy of its `fix.diff`, made when the second pass was added, since the first fix started from the release.

An earlier before round (in `runs/scratch`, not kept) was thrown out. The tool listed buttons hidden under the open cart drawer as clickable, which misled Kofi. That was fixed before this series.
