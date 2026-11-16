declare type PaginationResult<T> = Awaited<ReturnType<T>>['result'];

declare type ApiResult<T> = Awaited<ReturnType<T>>['result'];