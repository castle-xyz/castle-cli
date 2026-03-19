import _ from 'lodash';

export function isEqualUnordered(obj1: any, obj2: any) {
  return _.isEqualWith(obj1, obj2, (value1, value2) => {
    if (_.isObject(value1) && _.isObject(value2)) {
      return _.isMatch(value1, value2) && _.isMatch(value2, value1);
    }
    return undefined;
  });
}

export function mergeSkipArray(obj: any, src: any) {
  return _.mergeWith({}, obj, src, (objValue, srcValue) => {
    if (_.isArray(objValue) && _.isArray(srcValue)) {
      return srcValue;
    }
  });
}

export function serializeAngle(angle: number) {
  return angle * (180 / Math.PI);
}

export function deserializeAngle(angle: number) {
  return angle * (Math.PI / 180);
}
