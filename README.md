# README: LookML Project Transfer App Script 🚀

This Google Apps Script automates the process of transferring LookML projects between different Looker instances. It integrates directly with a Google Sheet to manage project details and provides real-time status updates, significantly streamlining your LookML deployment workflow.

---

## Overview

The script reads LookML project information from the active Google Sheet, fetches project details from a source Looker instance, creates a new project on a target Looker instance, automatically adds an SSH deploy key to the associated GitHub repository, and then deploys the project. It also includes functionality to validate a transferred project on demand.

---

## Features

* **Automated Project Transfer:** Transfers LookML projects from one Looker instance to another.

* **Centralized Configuration:** All Looker API credentials and the GitHub API key are managed via Apps Script properties, ensuring secure handling of sensitive information.

* **Real-time Status Updates:** The "Transfer Results" column in your Google Sheet is updated as the transfer progresses, providing visibility into each step.

* **GitHub Integration:** Automatically adds the generated SSH deploy key to your GitHub repository with write access.

* **Bulk Processing:** Processes multiple projects listed in the Google Sheet.

* **On-Demand Validation:** A custom menu in Google Sheets allows users to trigger validation for individual projects post-transfer.

* **Optimized API Calls:** Looker access tokens are generated once per script run and reused for all projects, reducing API overhead.

---

## Setup Instructions

To get this script up and running, follow these steps:

### 1. Google Apps Script Setup

#### A. Create/Open the Apps Script Project

1. Open your Google Sheet.

2. Go to `Extensions > Apps Script`. This will open the Apps Script editor.

3. Copy and paste the entire provided Apps Script code into the `Code.gs` file (or create a new `.gs` file and paste it there).

#### B. Set Script Properties (API Keys)

Sensitive information like API keys and base URLs are stored as **Script Properties** for security.

1. In the Apps Script editor, click on the **Project Settings** icon (⚙️) on the left sidebar.

2. Scroll down to **Script properties** and click `Add script property`.

3. Add the following properties with their corresponding values:

   * `SOURCE_BASE_URL`: The base URL of your source Looker instance (e.g., `https://source.looker.com`).

   * `SOURCE_CLIENT_ID`: The API client ID for your source Looker instance.

   * `SOURCE_CLIENT_SECRET`: The API client secret for your source Looker instance.

   * `TARGET_BASE_URL`: The base URL of your target Looker instance (e.g., `https://target.looker.com`).

   * `TARGET_CLIENT_ID`: The API client ID for your target Looker instance.

   * `TARGET_CLIENT_SECRET`: The API client secret for your target Looker instance.

   * `GITHUB_API_KEY`: A **GitHub Personal Access Token** with the `Administration` scope. This is essential for the script to add deploy keys to your repositories.

4. Click `Save properties`.
5. Add New Deployment -> Deploy as a Web App

---

### 2. Google Sheet Setup

Ensure your Google Sheet has the following header columns (case-sensitive) in the first row:

* `Looker Project`

* `Base Branch`

* `Git Connection Results`

* `Transfer Results`

* `Validate Project`

* `Validation Results`

Fill in the `Looker Project` (the ID of the project in the source Looker instance) and `Base Branch` (e.g., `master` or `main`) for each project you want to transfer. Leave the other columns empty initially or with "failed" if you want to re-run a transfer.

---

## How to Use

### 1. Authorize the Script

The first time you run any function from the script (e.g., by selecting `Looker Tools > Transfer Projects`), Google will ask you to authorize it. Follow the prompts to grant the necessary permissions.

---

### 2. Transferring Projects

1. **Open your Google Sheet.**

2. Go to the **"Looker Tools"** custom menu that appears in your Google Sheet's menu bar (it might take a few seconds to appear after opening the sheet or saving the script).

3. Click `Transfer Projects`.

4. The script will iterate through each row in your active sheet. If the "Transfer Results" column for a project is empty or says "failed", it will initiate the transfer process for that project.

5. The "Transfer Results" column will update in real-time with the status of each step (e.g., "Fetching project...", "Creating SSH deploy key...", "Successfully deployed project to production!").

---

### 3. Validating Projects

After a successful transfer, the "Validation Results" column will show "Ready to Validate". You can then manually trigger a validation:

1. **Select any cell** in the row of the project you wish to validate.

2. Go to the **"Looker Tools"** custom menu.

3. Click `Validate Selected Project`.

4. The script will call the Looker API's `validate_project` endpoint and update the "Validation Results" cell with either "Validation Succeeded" or "Validation Failed" (along with any error messages).

---

## GitHub API Key Permissions

The GitHub Personal Access Token (PAT) stored as `GITHUB_API_KEY` in Script Properties requires the **`Administration`** scope. This permission is necessary for the script to programmatically add deploy keys to your GitHub repositories with write access. If your API key has set expirey make sure to generate a new one and replace in your script when it is required.

---

## Troubleshooting

* **"No API key found" / "One or more API credentials are not set in Script Properties."**: Double-check that all required script properties (`SOURCE_BASE_URL`, `SOURCE_CLIENT_ID`, `SOURCE_CLIENT_SECRET`, `TARGET_BASE_URL`, `TARGET_CLIENT_ID`, `TARGET_CLIENT_SECRET`, `GITHUB_API_KEY`) are correctly set in your Apps Script project's settings.

* **"API call failed: ..."**: Inspect the error message in the Logger (View > Logger in Apps Script editor) for specifics. This usually indicates an issue with API credentials, URL, network, or the Looker instance itself.

* **Custom menu not appearing**: Close and reopen your Google Sheet. Sometimes it takes a moment for `onOpen()` to run and create the menu.

* **"Could not parse GitHub owner and repo from remote URL"**: Ensure your `git_remote_url` in the source Looker project is in a standard GitHub format (e.g., `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git`).

---

## Important Notes

* **GitHub Deploy Key:** The script automatically adds the deploy key to GitHub with **write access**. Ensure this is the desired level of access for your Looker projects.

* **Assumptions:** The script assumes that the project ID you want to transfer does not already exist on the target Looker instance. If it does, the `create_project` step will fail.

* **Environment Variables:** While the prompt referred to "env variables," in Google Apps Script, these are implemented as "Script Properties."
