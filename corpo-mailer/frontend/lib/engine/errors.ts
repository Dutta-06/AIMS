/** An error with an HTTP-like status, so the screens can treat engine errors like server ones. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: number) => new ApiError(404, `${what} ${id} not found`);
export const invalid = (message: string) => new ApiError(422, message);
export const conflict = (message: string) => new ApiError(409, message);
