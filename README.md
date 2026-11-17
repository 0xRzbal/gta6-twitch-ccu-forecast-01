# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/0xRzbal/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/0xRzbal/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts Grand Theft Auto VI's concurrent Twitch viewers for each hour of its release day from hour 1's print, as five quantiles an hour, by fitting the launch-day shape of 37 comparable launches in log space — kernel-weighted by how large each launch already was at hour 1.

## The idea

The house baseline holds hour 1's count flat with a random walk's spread. Launch days do not behave that way, and the kit's own comparables show it twice over.

A launch day rises. 35 of the 37 comparables finish above their hour-6 level, and the median peak hour is 20 of 24, because a rolling midnight-local unlock means only the first time zones are playing during hour 1 while Europe and the two US coasts arrive over the evening.

Size decides how hard. Split on hour-1 viewers, the small group's day ends at roughly 163 times hour 1 (about 99.5 times at a 20,000 split) and the big group's at about 1.3 times. The split is stable even though the exact ratio moves with the split point.

So the model fits `ln(viewers_h / viewers_1)` per hour across the comparables, weighted by a Gaussian kernel on log hour-1 viewers, and places the case's own hour 1 on the weighted median with the weighted 5th-to-95th spread around it.

## Measured

Leave-one-launch-out over the 37 launches, mean pinball loss on the log scale:

| Model | Mean | Median launch | Hour 1 >= 5,000 |
|---|---|---|---|
| This entry | 0.4064 | 0.2626 | 0.2703 |
| House baseline | 0.9296 | 0.3249 | 0.3595 |

Band calibration on held-out hours: 88.6% of outcomes fall inside the 5–95 interval, 55.8% inside the 25–75 interval.

Two variants measured better in-sample and did not survive validation, so neither ships: a hard regime cut at 5,000 first-hour viewers, and conditioning on the unlock mode's text. Both are documented in `main.ts`.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6j7nazy&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
