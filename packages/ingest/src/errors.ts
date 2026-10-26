export type IngestErrorCode = 'unsupported_type' | 'too_large' | 'empty' | 'missing_parser';

/** Why a file couldn't become knowledge. `message` is meant for the site owner, in English. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IngestError';
    this.code = code;
  }
}
