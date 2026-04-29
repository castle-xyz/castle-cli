# Getting Started

The Castle CLI (Command Line Interface) is a tool that helps you work with Castle decks on your computer. It allows you to:
- Download decks to your computer
- Edit your decks in a text editor
- Test changes to your decks in a web browser
- Upload your changes back to Castle

Here's a few reasons why you might want to use the Castle CLI:
- You can use tools such as [Cursor](https://www.cursor.com/) or [GitHub Copilot](https://github.com/features/copilot) along with the Castle CLI to help you write scripts for your decks
- You can work on decks together with other people by uploading your decks to [GitHub](https://github.com/)
- You want to backup and restore specific versions of your decks

### Prerequisites

Before you can install the Castle CLI, you'll need to install Node.js:

- Go to [nodejs.org](https://nodejs.org)
- Download the LTS (Long Term Support) version
- Run the installer
- To check the installation, open Terminal (Mac) or Command Prompt (Windows) and run:
  ```bash
  node --version
  npm --version
  ```
  You should see version numbers displayed for both commands

### Installing the Castle CLI

- Open Terminal (Mac) or Command Prompt (Windows)
- Install the Castle CLI using npm:
   ```bash
   npm install -g castle-cli
   ```
- Check the installation by running:
   ```bash
   castle help
   ```
   You should see a message explaining the commands available in the Castle CLI. If you don't see that, make sure that Node.js is installed correctly and then try installing the Castle CLI again

### Logging In

Before you can use the Castle CLI, you need to log in to your Castle account:

- Open Terminal (Mac) or Command Prompt (Windows)
- Run:
   ```bash
   castle login
   ```
- Your web browser will open automatically
- Log in to your Castle account in the browser
- Return to the Terminal / Command Prompt
- You should see a message confirming your successful login

### Downloading a Deck

To download a deck to your computer:

- Get a link to the deck you want to download. From the Castle app, click the share button and then copy the link. The link should look like `https://s.castle.xyz/...` or `https://castle.xyz/d/...`
- Run:
   ```bash
   castle clone <deck-link>
   ```
   Replace `<deck-link>` with the link to your deck
- The deck will be downloaded to a new folder on your computer
- Run this command to move into the new folder that was created:
  ```bash
  cd <new-directory>
  ```
  Replace `<new-directory>` with the directory that `castle clone` created. `castle clone` will display the name of the new directory once it completes

### Making Changes

After downloading a deck, you can:
- Edit the files in a text editor (see the [next section](./2-editing-decks.md) for examples)
- Test your changes locally using:
  ```bash
  castle serve
  ```
  This will open your web browser automatically with a preview of your deck, including any changes you've made in the text editor. When you make changes and save a file in the text editor, the web page will reload automatically to show those new changes. You can leave `castle serve` running in the background while you work on your deck

:::note
Make sure you are in the correct directory before running `castle serve`. Remember to run `cd <new-directory>` from the last step of [Downloading a Deck](#downloading-a-deck).
:::

### Saving Your Changes

When you're happy with your changes you can run:

```bash
castle push
```

To upload your changes back to Castle.

### Downloading Changes

If you made changes to your deck in the Castle app you can update the version on your computer by running:

```bash
castle pull
```

Be careful, this will overwrite any changes you've made on your computer if your local changes aren't compatible with the new version of the deck.
