import { z } from "zod";

/** A row id as the admin actions accept it (cuid today; the bound is generous). */
export const idSchema = z.string().min(1).max(64);
