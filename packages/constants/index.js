export const services = Object.freeze(['food', 'ride', 'package', 'vehicle', 'business']);
export const roles = Object.freeze(['customer', 'partner', 'business', 'restaurant', 'admin']);
export const registrationRoles = Object.freeze(roles.filter(role => role !== 'admin'));
export const activeStatuses = Object.freeze(['assigned', 'arriving', 'picked_up', 'in_transit']);
export const transitions = Object.freeze({requested:['cancelled'], assigned:['arriving'], arriving:['picked_up'], picked_up:['in_transit'], in_transit:['completed']});
export const workspaces = Object.freeze({customer:'/app', partner:'/partner', business:'/business', restaurant:'/restaurant', admin:'/operations'});
