import { ipcRenderer } from 'electron';
import { notification } from 'antd';
import { push } from 'react-router-redux';
import { showError } from './Session';
import UUID from 'uuid';
import Promise from 'bluebird';
import { getOptimalXPath } from '../util';

export const SET_SOURCE_AND_SCREENSHOT = 'SET_SOURCE';
export const SESSION_DONE = 'SESSION_DONE';
export const SELECT_ELEMENT = 'SELECT_ELEMENT';
export const UNSELECT_ELEMENT = 'UNSELECT_ELEMENT';
export const METHOD_CALL_REQUESTED = 'METHOD_CALL_REQUESTED';
export const METHOD_CALL_DONE = 'METHOD_CALL_DONE';
export const SET_FIELD_VALUE = 'SET_FIELD_VALUE';
export const SET_EXPANDED_PATHS = 'SET_EXPANDED_PATHS';
export const SELECT_HOVERED_ELEMENT = 'SELECT_HOVERED_ELEMENT';
export const UNSELECT_HOVERED_ELEMENT = 'UNSELECT_HOVERED_ELEMENT';
export const SHOW_SEND_KEYS_MODAL = 'SHOW_SEND_KEYS_MODAL';
export const HIDE_SEND_KEYS_MODAL = 'HIDE_SEND_KEYS_MODAL';
export const QUIT_SESSION_REQUESTED = 'QUIT_SESSION_REQUESTED';
export const QUIT_SESSION_DONE = 'QUIT_SESSION_DONE';

const clientMethodPromises = {};

/**
 * Calls a client method on the main process
 */
function callClientMethod (methodName, args, xpath) {
  let uuid = UUID.v4();
  let promise = new Promise((resolve, reject) => clientMethodPromises[uuid] = {resolve, reject});
  ipcRenderer.send('appium-client-command-request', {methodName, args, xpath, uuid});
  return promise;
}

/**
 * When we hear back from the main process, resolve the promise
 */
ipcRenderer.on('appium-client-command-response', (evt, resp) => {
  const {source, screenshot, result, uuid} = resp;
  let promise = clientMethodPromises[uuid];
  if (promise) {
    promise.resolve({source, screenshot, result});
    delete clientMethodPromises[uuid];
  }
});

/**
 * If we hear back with an error, reject the promise
 */
ipcRenderer.on('appium-client-command-response-error', (evt, resp) => {
  const {e, uuid} = resp;
  let promise = clientMethodPromises[uuid];
  if (promise) {
    promise.reject(e);
    delete clientMethodPromises[uuid];
  }
});

// Attributes on nodes that we know are unique to the node
// TODO: Need to confirm this list
const uniqueAttributes = [
  'name',
  'content-desc',
  'id',
  'accessibility-id',
];

/**
 * Translates sourceXML to JSON
 */
function xmlToJSON (source) {
  let recursive = (xmlNode, parentPath, index) => {

    // Translate attributes array to an object
    let attrObject = {};
    for (let attribute of xmlNode.attributes || []) {
      attrObject[attribute.name] = attribute.value;
    }

    // Dot Separated path of indices
    let path = (index !== undefined) && `${!parentPath ? '' : parentPath + '.'}${index}`;

    return {
      children: [...xmlNode.children].map((childNode, childIndex) => recursive(childNode, path, childIndex)),
      tagName: xmlNode.tagName,
      attributes: attrObject,
      xpath: getOptimalXPath(xmlNode, uniqueAttributes),
      path,
    };
  };

  let sourceXML = (new DOMParser()).parseFromString(source, 'text/xml').children[0];
  return recursive(sourceXML);
}


export function bindAppium () {
  return (dispatch) => {
    ipcRenderer.on('appium-session-done', () => {
      notification.error({
        message: "Error",
        description: "Session has been terminated",
        duration: 0
      });
      ipcRenderer.removeAllListeners('appium-client-command-response');
      ipcRenderer.removeAllListeners('appium-client-command-response-error');
      dispatch({type: SESSION_DONE});
    });
  };
}

export function selectElement (path) {
  return (dispatch, getState) => {
    dispatch({type: SELECT_ELEMENT, path});

    // Expand all of this element's ancestors so that it's visible in the tree
    let {expandedPaths} = getState().inspector;
    let pathArr = path.split('.').slice(0, path.length - 1);
    while (pathArr.length > 1) {
      pathArr.splice(pathArr.length - 1);
      let path = pathArr.join('.');
      if (expandedPaths.indexOf(path) < 0) {
        expandedPaths.push(path);
      }
    }

    dispatch({type: SET_EXPANDED_PATHS, paths: expandedPaths});
  };
}

export function unselectElement () {
  return (dispatch) => {
    dispatch({type: UNSELECT_ELEMENT});
  };
}

export function selectHoveredElement (path) {
  return (dispatch) => {
    dispatch({type: SELECT_HOVERED_ELEMENT, path});
  };
}

export function unselectHoveredElement (path) {
  return (dispatch) => {
    dispatch({type: UNSELECT_HOVERED_ELEMENT, path});
  };
}

/**
 * Requests a method call on appium
 */
export function applyClientMethod (params) {
  return async (dispatch) => {
    try {
      dispatch({type: METHOD_CALL_REQUESTED});
      let {source, screenshot, result} = await callClientMethod(params.methodName, params.args, params.xpath);
      dispatch({type: METHOD_CALL_DONE});
      dispatch({type: SET_SOURCE_AND_SCREENSHOT, source: xmlToJSON(source), screenshot});
      return result;
    } catch (error) {
      let methodName = params.methodName === 'click' ? 'tap' : params.methodName;
      showError(error, methodName, 10);
      dispatch({type: METHOD_CALL_DONE});
    }
  };
}

export function showSendKeysModal () {
  return (dispatch) => {
    dispatch({type: SHOW_SEND_KEYS_MODAL});
  };
}

export function hideSendKeysModal () {
  return (dispatch) => {
    dispatch({type: HIDE_SEND_KEYS_MODAL});
  };
}

/**
 * Set a value of an arbitrarily named field
 */
export function setFieldValue (name, value) {
  return (dispatch) => {
    dispatch({type: SET_FIELD_VALUE, name, value});
  };
}

export function setExpandedPaths (paths) {
  return (dispatch) => {
    dispatch({type: SET_EXPANDED_PATHS, paths});
  };
}

/**
 * Quit the session and go back to the new session window
 */
export function quitSession () {
  return async (dispatch) => {
    dispatch({type: QUIT_SESSION_REQUESTED});
    await applyClientMethod({methodName: 'quit'})(dispatch);
    dispatch({type: QUIT_SESSION_DONE});
    dispatch(push('/session'));
  };
}
