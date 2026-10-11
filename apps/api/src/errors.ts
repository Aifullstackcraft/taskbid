import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  OWN_TASK_BID: 'You cannot bid on your own task.',
  BIDDING_CLOSED: 'This task is not open for bids.',
  CAPACITY_EXCEEDED:
    'Your remaining capacity has changed or is too low. Refresh your workload and reduce the bid.',
  INVALID_STATUS_TRANSITION: 'Tasks must advance exactly one stage.',
  INVALID_BID_TRANSITION: 'This bid cannot change status.',
  ASSIGNMENT_INCONSISTENT: 'The accepted bid and assignment must match.',
  ACCEPTED_BID_REQUIRED: 'Assignment requires an accepted bid.',
  WORKLOAD_MANAGED: 'Workload is maintained by task assignments.',
  AUDIT_ACTOR_REQUIRED: 'A user must be selected for this operation.',
};
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the submitted fields.',
        details: error.issues,
      },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error.code === '23505') {
    res
      .status(409)
      .json({ error: { code: 'DUPLICATE_BID', message: 'You have already bid on this task.' } });
    return;
  }
  if (error.code === 'P0001') {
    res.status(409).json({
      error: {
        code: error.message,
        message: messages[error.message] ?? 'This change conflicts with a database business rule.',
      },
    });
    return;
  }
  if (['55P03', '40P01', '40001', '57014'].includes(error.code)) {
    res.status(503).json({
      error: {
        code: 'DATABASE_BUSY',
        message: 'Another operation is in progress. Please retry.',
      },
    });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'The request body must be valid JSON.' } });
    return;
  }
  if (['23503', '23514', '22P02'].includes(error.code)) {
    res.status(400).json({
      error: {
        code: 'INVALID_DATA',
        message: 'The supplied data violates a database constraint.',
      },
    });
    return;
  }
  console.error(error);
  res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
};
