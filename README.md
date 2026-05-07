# Castle CLI

Castle CLI creates, previews, edits, and saves Castle deck projects from local files.

## Install

```bash
npm install -g castle-cli
castle --help
```

## Start A Deck

Create a new local deck and serve it in a browser:

```bash
castle init my-deck --title "My Deck"
castle serve my-deck --open
```

`serve` runs in the foreground and prints the local preview URL. After editing project files, reload the active preview:

```bash
castle restart
castle logs
castle screenshot screenshot.png
```

## Get And Save

Get an existing deck by ID:

```bash
castle get-deck <deck-id> my-deck
castle serve my-deck --open
```

Save a local deck as an unlisted Castle deck:

```bash
castle save-deck my-deck
```

## Cards

```bash
castle add-card my-deck --title "Card 2"
castle remove-card <card-id> my-deck --force
```

## Project Files

Local projects use this shape:

```text
my-deck/
  deck.json
  cards/
    <card-id>/
      card.json
      scripts/
        main.lua
      scene/
        actors.yaml
        variables.yaml
        blueprints/
          main.yaml
          main.json
```

Edit Lua scripts directly. Generated scene YAML and blueprint JSON files are mainly for inspection; use `castle edit` for structural changes such as blueprints, actors, variables, layout, drawing assets, text settings, and rules.

## Updating From castle-cli Before 2.0.0

If you already have `castle-cli` installed from before version `2.0.0`, run the install command again to update it:

```bash
npm install -g castle-cli
```

Project directories created by `castle-cli` versions before `2.0.0` should be recreated with the new CLI. Move or remove the old local directory, then get the deck again:

```bash
mv my-deck my-deck-old
castle get-deck <deck-id> my-deck
castle serve my-deck --open
```
