# Terminal Stats Card — your own generator

A self-contained animated terminal SVG for your GitHub profile README.
No third-party actions, no external API, no dependencies. Node 18+ only.

## Files

    .github/workflows/terminal-stats.yml   the daily job
    scripts/terminal-stats.js              the generator
    .github-stats-config.json              your settings

## Install

1. Copy all three files into your profile repo (`<username>/<username>`),
   keeping the folder structure.
2. Settings -> Actions -> General -> Workflow permissions ->
   **Read and write permissions** -> Save.
3. Actions tab -> "Terminal Stats Card" -> Run workflow.
4. Add to your README.md:

       ![Terminal Stats](assets/github_stats.svg)

## Config options

| Key             | Values                                                              |
| --------------- | ------------------------------------------------------------------- |
| `theme`         | tokyonight, dracula, catppuccin, nord, gruvbox, monokai, hacker, github, ubuntu |
| `headerStyle`   | mac, windows, retro                                                 |
| `hostname`      | any string, shown in the prompt                                     |
| `typingSpeed`   | ms per character (default 55)                                       |
| `loop`          | true = animation repeats forever, false = plays once                |
| `width`         | SVG width in px                                                     |
| `commands`      | ordered list, see below                                             |
| `customCommands`| map of command string -> output text                                |
| `out`           | output path                                                         |

## Commands

`whoami`, `neofetch`, `languages`, `top-repos`, `ps`, `uptime`, `exit`,
plus anything you define in `customCommands`, e.g.

    "commands": ["whoami", "cat bio.txt", "languages", "exit"],
    "customCommands": {
      "cat bio.txt": "Backend engineer. Sofia, Bulgaria.\nCurrently: distributed systems."
    }

Use `\n` for multi-line output. Unknown commands render a
`command not found` line in red, which is sometimes the joke you want.

## Run locally

    node scripts/terminal-stats.js --user YOUR-NAME --out assets/github_stats.svg

Set `GITHUB_TOKEN` in your shell first if you hit rate limits.

## Notes

- Animation is pure CSS keyframes, so it plays inside GitHub's image proxy.
  Scripts would not run there; there are none.
- Stats come from the public REST API: profile, owned non-fork repos,
  star and fork totals, language mix by repo count, top 5 by stars,
  account age.
- The workflow only commits when the SVG actually changed, so your
  contribution graph does not fill up with noise.
