/** The average of one power over one bucket of time. */
export interface PowerBucket {
  start: Date;
  averageW: number;
}

/** Consecutive buckets of `bucketMs` from `from`, up to `to`. */
export interface BucketWindow {
  from: Date;
  to: Date;
  bucketMs: number;
}
