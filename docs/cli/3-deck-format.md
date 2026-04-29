# Deck Format

This section goes into more details about the deck format.

```
deck-123
├── .castle
├── .gitignore
├── .vscode
│   └── settings.json
├── card-123
│   ├── blueprints
│   │   ├── Wall.yaml
│   │   ├── Wall_rules.yaml
│   │   ├── Wall_script.lua
│   ├── card.yaml
│   └── layout.yaml
└── deck.yaml
```

Here's an example deck with one card and one blueprint in that card. We'll go through some of the files and explain how they work.

#### `deck-123`

This is the root level directory. `deck-<deck id>` is the default name that `castle clone` creates, but you can rename this to whatever you want.

#### `deck.yaml`

This file is used to mark this directory as a deck and needs to be at the root directory of your deck. The Castle CLI reads the deck ID for the current deck from this file. This file cannot be renamed.

#### `card-123`

This is a directory for a specific card. The card's layout and all of it's blueprints need to be under this directory. The Castle CLI searches for cards by looking for directories under the root deck directory that have a `card.yaml` file. You can rename or move this directory as long as it remains under the main deck directory.

#### `card.yaml`

This file is used to mark this directory as a card and needs to be at the root directory of each card. The Castle CLI reads the card ID from this file. This file cannot be renamed.

#### `layout.yaml`

This file contains the initial positions and configuration for each actor in the card. It must be at the root of the card directory and cannot be renamed.

#### `blueprints`

This is the default directory where blueprints are created. Blueprints can be moved anywhere inside the card directory, but any new blueprints will be created here.

#### `Wall.yaml`

This is an example blueprint file. The Castle CLI finds blueprint files by searching for YAML files that have a top level field named `entryId`. This file can be moved anywhere under the card directory and can be renamed. The title of the blueprint is taken from the `title` field in the YAML file, the name of the file does not matter.

#### `Wall_rules.yaml`

This is an example rules file. If a blueprint has rules, the Castle CLI will create a new rules file and link to that file from the main blueprint YAML file. This file can be renamed or moved, just make sure to update the file path in the main blueprint YAML file.

#### `Wall_script.lua`

This is an example script file. This works very similarly to the rules file. If a blueprint has a script, the Castle CLI will create a new script file and link to that file from the main blueprint YAML file. This file can be renamed or moved, just make sure to update the file path in the main blueprint YAML file.

#### `.castle`

This directory contains internal config files for the Castle CLI. It is recommended to check this directory into version control, with the exception of the `.castle/.cache` directory (this is reflected in the .gitignore file). This directory contains information about which versions of your cards are being used, so that if multiple people run `castle serve` they are guaranteed to see the same versions. It also contains information about which version of the Castle CLI is being used.

#### `.gitignore`

This file tells Git which files should not be checked into version control. Currently this only applies to the `.castle/cache` directory.

#### `.vscode`

This directory has a configuration file used by the VS Code text editor. You can delete this directory if you do not want to keep our default configuration.
