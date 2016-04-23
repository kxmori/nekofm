'use strict';

/* Directives */

angular.module('ng').
    directive('ngFocus', ['$timeout', function ($timeout) {
    return {
        link: function (scope, element, attrs) {
            scope.$watch(attrs.ngFocus, function (val) {
                if (angular.isDefined(val) && val) {
                    $timeout(function () { element[0].focus(); });
                }
            }, true);

            element.bind('blur', function () {
                if (angular.isDefined(attrs.ngFocusLost)) {
                    scope.$apply(attrs.ngFocusLost);

                }
            });
        }
    };
}]);
//angular.module('ng').directive('zKeypress', function () {
//    return {
//        restrict: 'A',
//        link: function (scope, elem, attr, ctrl) {
//            elem.bind('keypress', function () {
//                scope.$apply(function (s) {
//                    s.$eval(attr.zKeypress);
//                });
//            });
//        }
//    };
//});
//angular.module('ng').filter('favFilter', function () {
//    return function (items, id) {
//        var arrayToReturn = [];
//        for (var i = 0; i < items.length; i++) {
//            var entry = items[i];
//            if (!id || entry.tags.indexOf(id) != -1) {
//                arrayToReturn.push(entry);
//            }
//        }
//        return arrayToReturn;
//    }
//});
