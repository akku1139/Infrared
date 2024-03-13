export const JSONResponse = (j: Object): Response => {
  return new Response(
    JSON.stringify(j),
    {
      headers: {
        "Content-Type": "application/json",
      }
    }
  );
};
