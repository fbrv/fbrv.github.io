# fbrv.github.io

Personal engineering notebook. Hugo, no external theme — the layouts in `layouts/`
and the stylesheet in `assets/css/` are the design.

## Run it

```bash
hugo server -D          # http://localhost:1313, -D includes drafts
```

Hugo comes from the Nix flake (`.envrc` is `use flake`). Without direnv:
`nix develop -c hugo server -D`.

## Design system

"Engineering notebook": graph-paper ground, hairline rules, numbered entries,
margin sidenotes, figure-first. IBM Plex Mono for headings and metadata,
IBM Plex Sans for body. Light-first with a dark theme and a manual toggle.

All colour, measure and rhythm lives in the `:root` token block at the top of
`assets/css/main.css`. Change tokens there, not individual rules.

| Token | Role |
| --- | --- |
| `--paper` / `--panel` | page ground / raised surfaces |
| `--ink` / `--ink-2` / `--ink-3` | body, secondary, tertiary text |
| `--rule` / `--rule-soft` / `--grid` | hairlines and the graph grid |
| `--accent` | blueprint blue — links, callouts |
| `--mark` | amber — entry numbers, tags, § markers |
| `--measure` / `--margin-col` | text column / sidenote column |

### Reading width

`--measure` is in `ch` — the advance width of "0" — so the token reads as
characters per line. Running prose uses narrower glyphs on average, so real
characters land roughly 10% above the `ch` figure (70ch ≈ 75–78 characters).

Readers get a control in the masthead that cycles three steps, persisted in
`localStorage` and applied before first paint so there is no reflow:

| Setting | Measure | Sidenote column |
| --- | --- | --- |
| narrow | 58ch | 12rem |
| normal | 70ch | 13rem |
| wide | 84ch | 15rem |

With no stored choice the viewport decides: 70ch by default, 76ch above 1500px.
All five numbers live in the `--- reading width ---` block of
`assets/css/main.css` — tune them there and everything that uses the measure
(prose, sidenotes, spec panels, TOC, footer) follows.

## Writing

```bash
hugo new content/posts/my-entry.md
```

The archetype includes a `description` field. Fill it in — it is the search
snippet, the RSS summary, the social card and the `llms.txt` line.

### Shortcodes

Margin note (drops inline below 1000px):

```
{{< sidenote "1" >}}Only true on platforms with a coherent cache.{{< /sidenote >}}
```

Spec panel in the margin:

```
{{< spec title="Target" >}}
process | 130 nm
area    | 0.9 mm²
pins    | 24
{{< /spec >}}
```

Callout (`type="warn"` switches it to amber):

```
{{< note label="Caveat" >}}Measured on one board.{{< /note >}}
```

Figure with an auto-numbered "Fig. n" caption (`wide="true"` breaks the measure):

```
{{< figure src="/img/waveform.png" alt="SPI bus at 12 MHz" caption="Clock and data." >}}
```

## Machine-readable output

Built for search engines and for LLM/agent readers:

- **JSON-LD** — `BlogPosting` + `BreadcrumbList` on entries, `WebSite` + `Blog` on
  the home page, `CollectionPage` + `ItemList` on sections and tags.
- **`/llms.txt`** — site digest in the [llmstxt.org](https://llmstxt.org) format:
  summary, every entry with its description and date, topics, feeds.
- **Raw markdown per page** — append `index.md` to any page URL
  (`/posts/slug/index.md`) for the source with a citation header.
- **Full-text RSS** — `content:encoded`, not truncated summaries.
- **`robots.txt`** — AI crawlers explicitly allowed. Set
  `params.allowAICrawlers = false` in `hugo.toml` to switch every one of them to
  `Disallow`.
- Open Graph and Twitter card tags, canonical URLs, heading anchors, semantic
  `<article>` / `<time datetime>` markup.

## Syntax highlighting

`assets/css/syntax.css` is generated and scoped for both themes:

```bash
hugo gen chromastyles --style=github        # light
hugo gen chromastyles --style=github-dark   # dark
```

See the header of that file if you want to change styles.
