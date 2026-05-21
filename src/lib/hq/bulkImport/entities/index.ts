// Entity registration barrel. Importing this module registers every shipped
// bulk-import entity config at app boot. 5.9.3 (Vendor) + 5.9.4 (Venue) add
// their own registerEntity() calls here.

import { registerEntity } from "../registry";
import { projectConfig } from "./project";
import { vendorConfig } from "./vendor";
import { venueConfig } from "./venue";

registerEntity(projectConfig);
registerEntity(vendorConfig);
registerEntity(venueConfig);
