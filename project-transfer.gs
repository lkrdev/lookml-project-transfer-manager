/**
 * Title: Transfer Project App Script
 * Docs: This script takes a lookml project from one Looker instance and transfers it to another.
 * All the base and target Looker instances credentials are saved as env variables.
 * A GitHub API key that is allowed for adding deploy keys to the attached git repos is required.
 * Additionally each row once the test has passed will have an optional validate lookml project button that can be run.
 */

// Helper function to handle API authentication and return a token
function getAuthToken(baseUrl, clientId, clientSecret) {
  Logger.log('Authenticating with Looker at ' + baseUrl + '...');
  const url = baseUrl + '/api/4.0/login';
  const payload = {
    client_id: clientId,
    client_secret: clientSecret
  };
  
  const options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const token = JSON.parse(response.getContentText()).access_token;
    Logger.log('Authentication successful.');
    return token;
  } catch (e) {
    Logger.log('Authentication failed: ' + e.toString());
    throw new Error('Could not get authentication token.');
  }
}

// Helper function to make an API call with an access token and handle errors
function lookerApiCall(method, url, token, payload = null) {
  const options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true // Don't throw errors immediately, handle them manually
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  Logger.log(responseBody)
  if (responseCode >= 200 && responseCode < 300) {
    if (url.includes('/git/deploy_key') || url.includes('/deploy_to_production')) {
      return responseBody
    }
    return JSON.parse(responseBody);
  } else {
    Logger.log('API call failed with status code ' + responseCode);
    Logger.log('Response body: ' + responseBody);
    throw new Error('API call failed: ' + responseBody);
  }
}

/**
 * Main function to transfer a LookML project.
 * @param {Object} params - An object containing all necessary parameters.
 * @param {string} params.sourceBaseUrl - The base URL of the source Looker instance.
 * @param {string} params.targetBaseUrl - The base URL of the target Looker instance.
 * @param {string} params.projectId - The ID of the LookML project to transfer.
 * @param {string} params.baseBranch - The base branch to use for the new branch.
 * @param {string} params.newBranchName - The name for the new branch.
 * @param {string} sourceToken - The Looker API token for the source instance.
 * @param {string} targetToken - The Looker API token for the target instance.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The active sheet object.
 * @param {number} rowIndex - The row index of the project in the sheet.
 * @returns {Object} - Object with transfer result and the deploy key.
 */
function transferLookmlProject(params, sourceToken, targetToken, sheet, rowIndex) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const transferResultsIndex = headers.indexOf('Transfer Results');
  const transferResultsCol = transferResultsIndex + 1;
  
  function updateStatus(message) {
    Logger.log(message);
    sheet.getRange(rowIndex, transferResultsCol).setValue(message);
    SpreadsheetApp.flush();
  }

  try {
    updateStatus("Starting LookML project transfer...");
    
    // 1. Get project from source
    updateStatus("Fetching project '" + params.projectId + "' from source...");
    const sourceProjectUrl = params.sourceBaseUrl + '/api/4.0/projects/' + params.projectId;
    const sourceProject = lookerApiCall('get', sourceProjectUrl, sourceToken);
    updateStatus("Successfully fetched project from source.");

    // 2. Create a blank project on the target
    updateStatus("Switching to dev mode in project '" + params.projectId + "'");
    const devModeUrl = params.targetBaseUrl + '/api/4.0/session';
    lookerApiCall('patch', devModeUrl, targetToken, { workspace_id: 'dev'});
    updateStatus("Switched to dev mode successfully. Continuing...")
    updateStatus("Creating blank project '" + params.projectId + "' on target instance...");
    const newProjectUrl = params.targetBaseUrl + '/api/4.0/projects';
    const newProject = lookerApiCall('post', newProjectUrl, targetToken, { name: params.projectId });
    updateStatus("Successfully created blank project with ID: " + newProject.id);

    // 3. Create SSH deploy key
    updateStatus("Creating SSH deploy key...");
    const deployKeyUrl = params.targetBaseUrl + '/api/4.0/projects/' + newProject.id + '/git/deploy_key';
    const deployKeyResponse = lookerApiCall('post', deployKeyUrl, targetToken);
    const deployKey = deployKeyResponse;
    updateStatus("Successfully created SSH deploy key.");

    // 4. Add SSH deploy key to GitHub
    updateStatus("Adding SSH deploy key to GitHub...");
    const githubApiKey = PropertiesService.getScriptProperties().getProperty('GITHUB_API_KEY');
    if (!githubApiKey) {
      throw new Error('GitHub API key not found in Script Properties.');
    }

    const remoteUrl = sourceProject.git_remote_url;
    // Assumes URL format is git@github.com:owner/repo.git or https://github.com/owner/repo.git
    const match = remoteUrl.match(/(?:github.com[:/])([\w-]+)\/([\w-]+)(?:\.git)?/);
    if (!match) {
      throw new Error('Could not parse GitHub owner and repo from remote URL: ' + remoteUrl);
    }
    const owner = match[1];
    const repo = match[2];
    const deployKeyTitle = `${params.projectId}-${params.targetBaseUrl.split('//')[1].replace(/\./g, '-')}`;

    const githubUrl = `https://api.github.com/repos/${owner}/${repo}/keys`;
    const githubPayload = {
      title: deployKeyTitle,
      key: deployKey,
      read_only: false // Give write access
    };
    const githubOptions = {
      method: 'post',
      headers: {
        'Authorization': 'token ' + githubApiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(githubPayload),
      muteHttpExceptions: true
    };

    const githubResponse = UrlFetchApp.fetch(githubUrl, githubOptions);
    if (githubResponse.getResponseCode() >= 400) {
      Logger.log("Failed to add key to GitHub: " + githubResponse.getContentText());
      throw new Error("Failed to add key to GitHub: " + githubResponse.getContentText());
    }
    updateStatus("Successfully added deploy key to GitHub.");
    
    // 5. Update project with details from source and new deploy key
    updateStatus("Updating project with source details and deploy key...");
    const updatedProjectUrl = params.targetBaseUrl + '/api/4.0/projects/' + newProject.id;
    const updatedProjectBody = {
      git_remote_url: sourceProject.git_remote_url,
      git_service_name: sourceProject.git_service_name,
      git_deploy_key: deployKey,
    };
    lookerApiCall('patch', updatedProjectUrl, targetToken, updatedProjectBody);
    updateStatus("Successfully updated project.");

    // 6. Create new branch with retries
    updateStatus("Creating new branch '" + params.newBranchName + "'...");
    const branchCreationUrl = params.targetBaseUrl + '/api/4.0/projects/' + newProject.id + '/git_branch';
    const branchBody = { name: params.newBranchName, ref: 'origin/' + params.baseBranch };
    let branchCreated = false;
    let attempts = 0;
    const maxAttempts = 3;
    const retryDelays = [20, 60, 120]; // in seconds

    while (!branchCreated && attempts < maxAttempts) {
      try {
        const method = (attempts === 0) ? 'post' : 'put';
        lookerApiCall(method, branchCreationUrl, targetToken, branchBody);
        updateStatus("Successfully created new branch.");
        branchCreated = true;
      } catch (e) {
        attempts++;
        updateStatus("Failed to create git branch (attempt " + attempts + "/" + maxAttempts + ").");
        if (attempts < maxAttempts) {
          const delay = retryDelays[attempts - 1];
          updateStatus("Retrying in " + delay + " seconds...");
          Utilities.sleep(delay * 1000);
        } else {
          updateStatus("Max attempts reached. Exiting branch creation logic.");
          throw e; // Re-throw the error to exit the function
        }
      }
    }

    // 7. Run git connection tests
    updateStatus("Running git connection tests...");
    const gitTestsUrl = params.targetBaseUrl + '/api/4.0/projects/' + newProject.id + '/git_connection_tests';
    const tests = lookerApiCall('get', gitTestsUrl, targetToken);

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      const runTestUrl = gitTestsUrl + '/' + test.id;
      const result = lookerApiCall('get', runTestUrl, targetToken);
      if (!result.status.startsWith('pass')) {
        throw new Error('Git connection test "' + test.id + '" failed.');
      }
    }
    updateStatus("All git connection tests passed!");

    // 8. Deploy to production
    updateStatus("Deploying project to production...");
    const deployUrl = params.targetBaseUrl + '/api/4.0/projects/' + newProject.id + '/deploy_to_production';
    lookerApiCall('post', deployUrl, targetToken);
    updateStatus("Successfully deployed project to production.");
    
    // 9. Configure Models
    updateStatus("Configuring LookML models...");
    const sourceLookMLModelsUrl = params.sourceBaseUrl + '/api/4.0/lookml_models';
    const sourceModels = lookerApiCall('get', sourceLookMLModelsUrl, sourceToken);
    
    const targetCreateLookMLModelUrl = params.targetBaseUrl + '/api/4.0/lookml_models';
    let modelsConfiguredCount = 0;

    for (let j = 0; j < sourceModels.length; j++) {
      const model = sourceModels[j];
      if (model.project_name === params.projectId) {
        updateStatus(`Creating model '${model.name}' for project '${params.projectId}' on target...`);
        const modelPayload = {
          name: model.name,
          project_name: params.projectId,
          allow_all_db_connections: true
        };
        lookerApiCall('post', targetCreateLookMLModelUrl, targetToken, modelPayload);
        modelsConfiguredCount++;
        updateStatus(`Model '${model.name}' configured successfully.`);
      }
    }
    updateStatus(`Successfully configured ${modelsConfiguredCount} LookML models.`);

    updateStatus("LookML project transfer completed successfully!");
    return { status: "success"};

  } catch (e) {
    updateStatus("Transfer failed: " + e.toString());
    return { status: "failed"};
  }
}

/**
 * Creates a custom menu in the Google Sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Looker Tools')
    .addItem('Transfer Projects', 'transferProjectsFromSheet')
    .addItem('Validate Selected Project', 'validateSelectedProject')
    .addToUi();
}

/**
 * Reads project data from the active Google Sheet and initiates the transfer.
 */
function transferProjectsFromSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    throw new Error('Active sheet not found.');
  }

  // Retrieve API credentials from Script Properties
  const scriptProperties = PropertiesService.getScriptProperties();
  const sourceBaseUrl = scriptProperties.getProperty('SOURCE_BASE_URL');
  const sourceClientId = scriptProperties.getProperty('SOURCE_CLIENT_ID');
  const sourceClientSecret = scriptProperties.getProperty('SOURCE_CLIENT_SECRET');
  const targetBaseUrl = scriptProperties.getProperty('TARGET_BASE_URL');
  const targetClientId = scriptProperties.getProperty('TARGET_CLIENT_ID');
  const targetClientSecret = scriptProperties.getProperty('TARGET_CLIENT_SECRET');

  if (!sourceBaseUrl || !sourceClientId || !sourceClientSecret || !targetBaseUrl || !targetClientId || !targetClientSecret) {
    throw new Error('One or more API credentials are not set in Script Properties.');
  }
  
  // Authenticate with Looker instances once before the loop
  const sourceToken = getAuthToken(sourceBaseUrl, sourceClientId, sourceClientSecret);
  const targetToken = getAuthToken(targetBaseUrl, targetClientId, targetClientSecret);

  // Get all data from the sheet
  const range = sheet.getDataRange();
  const values = range.getValues();
  
  // Find column indexes based on header row
  const header = values[0];
  const projectIdIndex = header.indexOf('Looker Project');
  const baseBranchIndex = header.indexOf('Base Branch');
  const transferResultsIndex = header.indexOf('Transfer Results');
  const gitConnectionResultsIndex = header.indexOf('Git Connection Results');
  const validationResultsIndex = header.indexOf('Validation Results');
  
  // Iterate through each row of data (skipping the header)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const projectId = row[projectIdIndex];
    const baseBranch = row[baseBranchIndex];
    const transferResults = row[transferResultsIndex];

    // Check if the row should be processed
    if (transferResults === "" || transferResults === "failed") {
      
      const newBranchName = 'transferred_project_' + projectId.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      const params = {
        sourceBaseUrl,
        targetBaseUrl,
        projectId,
        baseBranch,
        newBranchName
      };

      const result = transferLookmlProject(params, sourceToken, targetToken, sheet, i + 1);
      
      // Update the sheet with the transfer result and other information
      const resultCell = sheet.getRange(i + 1, transferResultsIndex + 1);
      resultCell.setValue(result.status);
      
      if (result.status === "success") {
        const gitConnectionCell = sheet.getRange(i + 1, gitConnectionResultsIndex + 1);
        gitConnectionCell.setValue("Passed. Please add the deploy key to your Git provider.");
        
        const validationCell = sheet.getRange(i + 1, validationResultsIndex + 1);
        validationCell.setValue("Ready to Validate");
      } else {
        const gitConnectionCell = sheet.getRange(i + 1, gitConnectionResultsIndex + 1);
        gitConnectionCell.setValue("Failed.");
        const validationCell = sheet.getRange(i + 1, validationResultsIndex + 1);
        validationCell.setValue("N/A");
      }
      SpreadsheetApp.flush(); // Force the spreadsheet to update
    }
  }
}

/**
 * Validates the LookML project for the selected row.
 */
function validateSelectedProject() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const activeCell = sheet.getActiveCell();
  const row = activeCell.getRow();
  
  if (row === 1) { // Skip header row
    SpreadsheetApp.getUi().alert('Please select a project row to validate.');
    return;
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const projectIdIndex = headers.indexOf('Looker Project');
  const validationResultsIndex = headers.indexOf('Validation Results');
  
  const projectId = data[projectIdIndex];
  
  if (!projectId) {
    SpreadsheetApp.getUi().alert('The selected row does not have a Looker Project ID.');
    return;
  }
  
  const scriptProperties = PropertiesService.getScriptProperties();
  const targetBaseUrl = scriptProperties.getProperty('TARGET_BASE_URL');
  const targetClientId = scriptProperties.getProperty('TARGET_CLIENT_ID');
  const targetClientSecret = scriptProperties.getProperty('TARGET_CLIENT_SECRET');
  
  if (!targetBaseUrl || !targetClientId || !targetClientSecret) {
    SpreadsheetApp.getUi().alert('Target Looker API credentials are not set in Script Properties.');
    return;
  }
  
  try {
    const targetToken = getAuthToken(targetBaseUrl, targetClientId, targetClientSecret);
    
    Logger.log("Validating project '" + projectId + "'...");
    
    // Call the Looker API validate project endpoint
    const validateUrl = targetBaseUrl + '/api/4.0/projects/' + projectId + '/validate';
    const validationResult = lookerApiCall('post', validateUrl, targetToken);
    
    let validationStatus = '';
    if (validationResult.errors && validationResult.errors.length > 0) {
      const errorMessages = validationResult.errors.map(err => err.message).join('\n');
      validationStatus = 'Validation Failed: ' + errorMessages;
      Logger.log('Validation Failed: ' + errorMessages);
    } else {
      validationStatus = 'Validation Succeeded';
      Logger.log('Validation Succeeded');
    }
    
    sheet.getRange(row, validationResultsIndex + 1).setValue(validationStatus);
    SpreadsheetApp.flush();
    
  } catch (e) {
    Logger.log("Validation failed: " + e.toString());
    sheet.getRange(row, validationResultsIndex + 1).setValue("Validation Failed: " + e.toString());
    SpreadsheetApp.flush();
  }
}
