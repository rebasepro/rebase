import { configure } from "@testing-library/react";
import { TextEncoder, TextDecoder } from "util";

configure({ asyncUtilTimeout: 15_000 });
Object.assign(global, { TextDecoder,
TextEncoder });
