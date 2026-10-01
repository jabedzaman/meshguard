import { createApiClient } from "@mesh/api-client";
import { API_URL } from "~/lib/env";

export const api = createApiClient(API_URL);
