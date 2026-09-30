# FilePilot Privacy Policy

Last updated: September 30, 2026

FilePilot is a local-first Windows desktop application for organizing files with the assistance of user-configured AI model services.

This Privacy Policy explains what information FilePilot accesses, what information may be transmitted to third-party services, and what information remains on the user's device.

## 1. Local File Access

FilePilot accesses files and directories selected by the user in order to analyze and organize them.

Depending on the file type and the operation being performed, FilePilot may locally access information such as:

- File and folder names and paths
- Directory structure
- File metadata
- Text or content excerpts from supported documents
- Spreadsheet structure and sample rows
- Archive contents or file listings
- Image metadata
- Other information needed to generate an organization plan

File operations such as scanning directories, displaying organization plans, moving files, performing pre-checks, maintaining organization history, and performing rollback operations are executed locally on the user's device.

FilePilot does not operate a cloud storage service and does not upload users' files to a FilePilot-operated server.

## 2. AI Model Services

FilePilot does not provide or operate its own hosted AI model service.

Users configure their own OpenAI-compatible model endpoint, model name, and API credentials. This may include services such as OpenAI, DeepSeek, other compatible providers, self-hosted services, or local services such as Ollama.

When AI-assisted analysis or planning is performed, FilePilot may send information derived from user-selected files to the model provider configured by the user. Depending on the operation, this information may include:

- File and folder names
- Directory structure
- Extracted file metadata
- Extracted text or content excerpts
- Summaries of file contents
- Organization rules and task context

FilePilot normally extracts and sends only the information needed for analysis rather than uploading complete large files.

The privacy practices, data retention policies, security practices, and terms of service of these model providers are determined by the provider selected by the user and are outside FilePilot's control.

Users should review the privacy policy of their chosen model provider before processing sensitive files.

## 3. Image Analysis

Image understanding is optional and is disabled by default.

When image analysis is disabled, FilePilot does not send image content to an image-understanding model for file analysis.

If the user enables image analysis, FilePilot may transmit the content of selected image files to the configured vision-capable model service so that the service can generate a description of the image.

Image data may be encoded directly in the model request or otherwise made temporarily available to the configured model endpoint as required for compatibility.

The handling and retention of transmitted images are governed by the privacy policy of the model provider selected by the user.

## 4. Icon Workbench and Image Generation

FilePilot includes optional icon-generation features.

When these features are used, FilePilot may send information such as folder names, parent-folder names, directory structure summaries, and generated prompts to model services configured by the user.

Image-generation prompts are sent to the image-generation endpoint selected by the user.

If the optional background-removal feature uses a remote service, the image being processed may be uploaded to the selected Hugging Face Space, Gradio endpoint, or other configured background-removal service.

These operations occur only when the associated feature is used.

Third-party services process this information according to their own privacy policies and terms.

## 5. API Keys and Credentials

Model API keys and other service credentials configured in FilePilot are stored locally on the user's device.

In the packaged Windows desktop application, FilePilot stores application configuration in its local application data directory, including a local `config.json` file.

FilePilot does not transmit these credentials to a FilePilot-operated service. Credentials are used to authenticate requests to the third-party service configured by the user.

FilePilot masks stored credentials when returning configuration information to the user interface and attempts to redact API keys, authorization headers, tokens, passwords, and similar sensitive values from diagnostic logs.

However, FilePilot currently does not independently encrypt the local `config.json` configuration file. Users are responsible for maintaining the security of their Windows account and local application data.

Users may remove or replace stored credentials through FilePilot's settings.

## 6. Local History, Sessions, and Logs

FilePilot stores information locally to support organization history, recovery, troubleshooting, and rollback.

Local records may include:

- Organization sessions
- Organization plans and results
- Source and destination file paths
- Execution history
- Rollback information
- Application configuration
- Runtime logs
- Optional debug logs

These records are stored within FilePilot's local application data directory.

Execution history is retained locally so that users can review previous operations and perform supported rollback operations. Users can delete individual history entries from FilePilot.

Normal backend runtime logs are rotated periodically, with a limited number of backup log files retained.

Debug logging is disabled by default. If the user enables debug logging, additional diagnostic information may be stored locally. FilePilot applies redaction to commonly recognized credential fields, but debug information may still contain file paths, model request metadata, error information, or other operational context.

Users should avoid sharing diagnostic logs publicly without reviewing their contents.

## 7. Telemetry and Analytics

FilePilot does not include a FilePilot-operated analytics, advertising, tracking, or telemetry service.

FilePilot does not send usage statistics, file inventories, or behavioral analytics to the FilePilot developer.

Network communication initiated by FilePilot is primarily associated with services explicitly used or configured by the user, such as AI model providers, image-generation providers, or optional image-processing services.

## 8. Data Retention and Deletion

Information stored locally by FilePilot remains on the user's device until it is deleted through FilePilot, overwritten during normal application operation, removed manually, or the corresponding application data is deleted.

Users may delete supported history entries from within FilePilot.

Users may also remove FilePilot's locally stored configuration, logs, sessions, and other application data from the FilePilot application data directory.

Deleting local FilePilot data does not delete information that may already have been transmitted to a third-party model or processing service. Requests regarding data retained by a third-party provider must be handled according to that provider's privacy policy and account controls.

## 9. Third-Party Services

FilePilot may interact with third-party services selected or enabled by the user, including:

- OpenAI-compatible text model providers
- Vision model providers
- Image-generation providers
- Hugging Face Spaces or compatible Gradio services used for optional image processing
- Self-hosted or locally hosted model services

FilePilot is not responsible for the privacy practices, security measures, data retention policies, or terms of these third-party services.

The exact third parties involved depend on the services configured or features used by the user.

## 10. User Controls

Users can control what information is processed externally by:

- Choosing which files and directories FilePilot processes
- Selecting their own model provider
- Using a locally hosted model instead of a cloud service
- Disabling optional image analysis
- Choosing whether to use icon-generation or background-removal features
- Removing or replacing stored API credentials
- Disabling debug logging
- Deleting organization history
- Removing FilePilot's local application data

Users handling confidential or sensitive files are encouraged to use model providers and settings appropriate for the sensitivity of their data.

## 11. Changes to This Policy

This Privacy Policy may be updated as FilePilot's features or data-processing behavior change.

Changes will be published in the FilePilot repository, and the "Last updated" date at the top of this document will be revised accordingly.

## 12. Contact

For privacy questions, bug reports, or security concerns related to FilePilot, please open an issue in the FilePilot GitHub repository:

https://github.com/qup1010/FilePilot
