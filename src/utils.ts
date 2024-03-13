export const json = (j: Object, status: number): Response => {
  return new Response(
    JSON.stringify(j),
    {
      status: status,
      headers: {
        "Content-Type": "application/json",
      }
    }
  );
};

export const error = (e: Error, code: string, id: string, status: number = 500): Response => {
  return json({
    code: code,
    id: id,
    message: e.message,
    stack: e.stack,
  }, status);
}
