/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
'use strict';
// tslint:disable no-unused-expression

import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as chai from 'chai';
import * as sinonChai from 'sinon-chai';
import * as path from 'path';
import { TutorialView } from '../../src/webview/TutorialView';

chai.use(sinonChai);

describe('TutorialView', () => {
    let mySandBox: sinon.SinonSandbox;

    beforeEach(async () => {
        mySandBox = sinon.createSandbox();

        await vscode.workspace.getConfiguration().update('extension.home.showOnStartup', true, vscode.ConfigurationTarget.Global);
    });

    afterEach(() => {
        mySandBox.restore();
    });

    it('should show tutorial', async () => {
        const commandSpy: sinon.SinonSpy = mySandBox.spy(vscode.commands, 'executeCommand');

        const tutorialView: TutorialView = new TutorialView('IBMCode/Code-Tutorials', 'Developing smart contracts with IBM Blockchain VSCode Extension');
        await tutorialView.openView();

        const filePath: string = path.join(__dirname, '..', '..', '..', 'tutorials', 'ibm-blockchain-platform-vscode-smart-contract/index.md');
        const uri: vscode.Uri = vscode.Uri.file(filePath);

        commandSpy.should.have.been.calledWith('markdown.showPreviewToSide', uri);
    });

    it('should do nothing on openPanelInner', async () => {
        const tutorialView: TutorialView = new TutorialView('IBMCode/Code-Tutorials', 'Developing smart contracts with IBM Blockchain VSCode Extension');
        await tutorialView['openPanelInner']();
    });

    it('should return empty string on getHTMLString', async () => {
        const tutorialView: TutorialView = new TutorialView('IBMCode/Code-Tutorials', 'Developing smart contracts with IBM Blockchain VSCode Extension');
        const result: string = await tutorialView['getHTMLString']();
        result.should.equal('');
    });
});
